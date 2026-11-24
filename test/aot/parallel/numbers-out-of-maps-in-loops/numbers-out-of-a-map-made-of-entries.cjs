"use strict";
// STATISTIC: MapResultsGuardedAsNumbers >= 4
// STATISTIC: CollectionLookupsHoisted >= 4
const turns = JSON.parse("8") | 0;
// Four numbers are read out of a Map in each turn. Nobody has seen what the Map holds.
const settings = new Map(Object.entries(JSON.parse("{\"port\":8080,\"body\":100,\"ttl\":60.5,\"depth\":-0}")));
function sum(t) { let s = 0; for (let i = 0; i < turns; i++) s += settings.get("port") + settings.get("body") + settings.get("ttl") + settings.get("depth") + t; return s; }
const out = []; for (let t = 0; t < 4; t++) out.push(sum(t)); console.log(out.join());
