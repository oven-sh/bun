"use strict";
// The turn counts itself in a field, then reckons a key. A key that is no int32 begins the turn again in the other copy: the field must have been put back, or the turn counts twice.
function fill(things, room, tally) { const best = new Array(room + 1).fill(0); for (const thing of things) for (let at = room; at >= thing.weight; at--) { tally.turns = tally.turns + 1; const worth = best[at - thing.weight] + thing.worth; if (worth > best[at]) best[at] = worth; } return tally.turns + ":" + Object.keys(best).map(key => key + "=" + best[key]).join(","); }
function things(first, second, third) { return [{ weight: first, worth: 0.5 }, { weight: second, worth: 2.75 }, { weight: third, worth: 5 }]; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) out = fill(things(1, 3, 4), 20 + (turn & 3), { turns: 0 });
out += "\n" + fill(things(2, 2.5, 3), 12, { turns: 0 });
out += "\n" + fill(things(0.5, 0.5, 0.5), 6, { turns: 0 });
out += "\n" + fill(things(2, -0, 3), 9, { turns: 0 });
out += "\n" + fill(things(2, -1, 3), 9, { turns: 0 });
out += "\n" + fill(things(1, NaN, 2), 9, { turns: 0 });
out += "\n" + fill(things(1, 1e21, 2), 9, { turns: 0 });
console.log(out);
