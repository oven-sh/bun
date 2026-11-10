"use strict";
function run(list, tally, offsets) { let done = 0; for (let turn = 0; turn < offsets.length; turn++) { tally.seen = tally.seen + 1; done += 1; const found = list[turn - offsets[turn].by]; list[turn] = (found === undefined ? 0.25 : found) + tally.seen; } return done + ":" + tally.seen + ":" + list.join(); }
function offsets(given) { return given.map(by => ({ by })); }
function fresh() { return [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]; }
const turns = +process.argv[2] || 40; let out = "";
for (let turn = 0; turn < turns; turn++) out = run(fresh(), { seen: 0 }, offsets([0, 1, 1, 2, 0, 3]));
out += "\n" + run(fresh(), { seen: 0 }, offsets([0, 0.5, 1, NaN, 1, -0, 2, 1e21, 0])) + "\n" + run(fresh(), { seen: 0 }, offsets([0.5, 0.5, 0.5])) + "\n" + run(fresh(), { seen: 0 }, offsets([0, 1, -20, 1, Infinity, 2]));
console.log(out);
