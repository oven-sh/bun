"use strict";
// STATISTIC: MapResultsGuardedAsNumbers >= 1
// STATISTIC: CollectionLookupsHoisted = 0
// The turn stores what it has read: each turn finds what the turn before it laid.
const counts = new Map(Object.entries(JSON.parse("{\"seen\":1,\"step\":2}")));
function run(n) { let s = 0; for (let i = 0; i < n; i++) { s += counts.get("seen") + counts.get("step"); counts.set("seen", counts.get("seen") + counts.get("step")); } return s; }
const out = []; for (let t = 0; t < 4; t++) out.push(run(JSON.parse("5") | 0)); console.log(out.join(), counts.get("seen"));
