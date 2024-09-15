"use strict";

(async () => {
	const feature = featureManager.registerFeature(
		"Show Faction Spy",
		"faction",
		() => settings.pages.faction.showFactionSpy,
		registerListeners,
		fetchAndAddSpies,
		removeSpies,
		{
			storage: [
				"settings.pages.faction.showFactionSpy",
				"settings.external.tornstats",
				"settings.external.yata",
				"scripts.statsEstimate.global",
				"scripts.statsEstimate.factions",
				"scripts.statsEstimate.wars",
				"scripts.statsEstimate.rankedWars",
			],
		},
		() => {
			if (!hasAPIData()) return "No API access.";
			if (!settings.external.tornstats || !settings.external.yata) return "Both TornStats and YATA are disabled.";
			if (
				settings.scripts.statsEstimate.global &&
				settings.scripts.statsEstimate.factions &&
				settings.scripts.statsEstimate.wars &&
				settings.scripts.statsEstimate.rankedWars
			)
				return "Stats Estimate is not disabled for any of factions, wars or ranked wars.";
		}
	);

	function registerListeners() {
		window.addEventListener("hashchange", async (e) => {
			if (!feature.enabled()) return;

			if (e.newURL.includes("#/war/rank")) await fetchAndAddSpies();
			else removeSpies(true);
		});
	}

	async function fetchAndAddSpies() {
		removeSpies();

		if (location.hash.includes("#/war/rank")) await showRWSpies();

		// No need for members spies of user's faction.
		if (isOwnFaction) return;

		// Add spy data to members list.
		const spies = await fetchSpies(await getFactionID());

		await requireElement(".members-list .table-body > li .status");

		const tableBody = document.find(".members-list .table-body");
		tableBody.classList.add("tt-modified-faction-spy");

		[...tableBody.children].forEach((row) => {
			const memberID = row.find(".member.icons [href*='/profiles.php']").getAttribute("href").split("XID=")[1];
			let spyData = spies[memberID];

			let statFields = [];
			if (spyData) {
				for (const stat of ["strength", "defense", "speed", "dexterity", "total"])
					spyData[stat] = formatNumber(spyData[stat], { shorten: 3, decimals: 3 });
				spyData.timestamp = formatTime({ seconds: spyData.timestamp }, { type: "ago", short: true });
				statFields = [
					`Strength: ${spyData.strength}`,
					`Defense: ${spyData.defense}`,
					`Speed: ${spyData.speed}`,
					`Dexterity: ${spyData.dexterity}`,
					`Total: ${spyData.total}`,
					`⏱: ${spyData.timestamp}`,
				]
					.slice(mobile ? 4 : 0)
					.map((text) => document.newElement({ type: "div", text: text }));
			} else statFields.push(document.newElement({ type: "div", text: "No spy found." }));

			const spyElement = document.newElement({
				type: "div",
				class: "tt-faction-spy",
				children: statFields,
			});
			row.appendChild(spyElement);
		});
	}

	async function showRWSpies() {
		const enemiesMembersList = await requireElement(".act[class*='warListItem__'] ~ .descriptions .faction-war .enemy-faction.left .members-list");
		const enemyFactionID = enemiesMembersList.find("a[href*='/factions.php?step=profile&ID=']").getAttribute("href").split("ID=")[1];

		const spies = await fetchSpies(enemyFactionID);

		[...enemiesMembersList.children].forEach((row) => {
			const memberID = row.find("a[href*='/profiles.php']").getAttribute("href").split("XID=")[1];
			let spyData = spies[memberID];

			let statFields = [];
			if (spyData) {
				for (const stat of ["strength", "defense", "speed", "dexterity", "total"])
					spyData[stat] = formatNumber(spyData[stat], { shorten: 3, decimals: 3 });
				spyData.timestamp = formatTime({ seconds: spyData.timestamp }, { type: "ago", short: true });

				statFields = [`Total: ${spyData.total}`, `⏱: ${spyData.timestamp}`].map((text) => document.newElement({ type: "div", text: text }));
			} else statFields.push(document.newElement({ type: "div", text: "No spy found." }));

			const spyElement = document.newElement({
				type: "div",
				class: "tt-faction-rw-spy",
				children: statFields,
			});
			row.appendChild(spyElement);
		});
	}

	async function fetchSpies(factionID) {
		let spies = {};

		if (settings.external.tornstats) {
			// await fetchData(FETCH_PLATFORMS.tornstats, { section: "spy/faction", id: "38044" });
			// await fetchData(FETCH_PLATFORMS.tornstats, { section: "spy/faction", id: "40992" });

			let data;
			if (ttCache.hasValue("faction-spy-tornstats", factionID)) data = ttCache.get("faction-spy-tornstats", factionID);
			else {
				data = await fetchData(FETCH_PLATFORMS.tornstats, { section: "spy/faction", id: factionID });
				ttCache.set({ [factionID]: data }, TO_MILLIS.HOURS, "faction-spy-tornstats");
			}

			if (data.status && data.faction.spies) {
				for (const memberID of Object.keys(data.faction.members)) spies[memberID] = data.faction.members[memberID].spy;
			}
		} else if (settings.external.yata) {
			// await fetchData(FETCH_PLATFORMS.yata, { relay: true, section: "spies", includeKey: true, params: { faction: "38044" } });
			// await fetchData(FETCH_PLATFORMS.yata, { relay: true, section: "spies", includeKey: true, params: { faction: "40992" } });

			let data;
			if (ttCache.hasValue("faction-spy-yata", factionID)) data = ttCache.get("faction-spy-yata", factionID);
			else {
				data = await fetchData(FETCH_PLATFORMS.yata, { relay: true, section: "spies", includeKey: true, params: { faction: factionID } });
				ttCache.set({ [factionID]: data }, TO_MILLIS.HOURS, "faction-spy-yata");
			}

			if (Object.keys(data.spies).length) {
				for (const [memberID, spyData] of Object.entries(data.spies))
					spies[memberID] = {
						strength: spyData.strength,
						defense: spyData.defense,
						speed: spyData.speed,
						dexterity: spyData.dexterity,
						timestamp: spyData.update,
					};
			}
		} else throw new Error("Please enable TornStats or YATA.");

		// Sometimes, the modifications of the `spies` object causes unnecessary
		// modifications during storage. Returning a clone instead.
		return window.structuredClone(spies);
	}

	async function getFactionID() {
		if (isOwnFaction) {
			if (userdata.faction_id) return userdata.faction_id;

			const userID = userdata.player_id;
			if (!userID) return null; // ID could not be found

			return await getFactionIDFromUser(userID);
		}

		const hashparams = getSearchParameters();

		if (isIntNumber(hashparams.get("ID"))) return parseInt(hashparams.get("ID"));
		if (isIntNumber(hashparams.get("userID"))) return await getFactionIDFromUser(parseInt(hashparams.get("userID")));

		return null; // ID could not be found

		async function getFactionIDFromUser(userID) {
			const cached = ttCache.get("faction-id", userID);
			if (cached) return cached;

			const data = await fetchData("torn", { section: "user", selections: ["profile"], id: userID });
			const factionID = data.faction.faction_id;
			ttCache.set({ [userID]: factionID }, 1 * TO_MILLIS.DAYS, "faction-id");
			return factionID;
		}
	}

	function removeSpies(onlyRWSpies = false) {
		if (!onlyRWSpies) {
			document.find(".tt-modified-faction-spy")?.classList.remove("tt-modified-faction-spy");
			document.findAll(".tt-faction-spy").forEach((x) => x.remove());
		}
		document.findAll(".tt-faction-rw-spy").forEach((x) => x.remove());
	}
})();