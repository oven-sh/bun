"use strict";
function fill(things, room) { const best = new Array(room + 1).fill(0); for (const thing of things) for (let at = room; at >= thing.weight; at--) { const worth = best[at - thing.weight] + thing.worth; if (worth > best[at]) best[at] = worth; } return Object.keys(best).map(key => key + "=" + best[key]).join(","); }
function things(weights) { return weights.map((weight, place) => ({ weight, worth: place * 2.25 + 0.5 })); }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) out = fill(things([1, 3, 4, 2, 6, 5]), 20 + (turn & 3));
for (const odd of [0.5, 1.5, NaN, -0, -1, -3, -0.5, 2 ** 31, 2 ** 32, 1e21, Infinity, 5, 7, 12, 13]) out += "\n" + odd + ":" + fill(things([2, odd, 3]), 12) + "|" + fill(things([odd]), 5) + "|" + fill(things([1, 2, 3, odd]), 7);
console.log(out);
