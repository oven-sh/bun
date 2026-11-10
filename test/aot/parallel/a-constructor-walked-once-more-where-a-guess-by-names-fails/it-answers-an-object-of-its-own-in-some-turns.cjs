// STATISTIC: CallsInlinedAfterFailedGuards >= 1
"use strict";
// A constructor that returns an object gives that object.
function Plate(from) { this.wide = from.wide; this.tall = from.tall; return from.instead; }
const shelf = { Plate }, names = JSON.parse('["Plate"]'), kept = JSON.parse("[]");
for (let i = 0; i < 8; i++) kept.push(new shelf[names[0]]({ wide: i, tall: 1 }));
function handed(i, turn) { return i === 4 ? { wide: 1, tall: 2, instead: { wide: "other", tall: "object" } } : kept[i]; }
function run(turn) {
    const said = [];
    for (let i = 0; i < 8; i++) {
        const made = new (shelf[names[0]])(handed(i, turn));
        said.push(made.wide + ":" + made.tall);
    }
    return said.join(" ");
}
const printed = [];
for (let turn = 0; turn < 6; turn++) printed.push(run(turn));
console.log(printed.join(" | "));
