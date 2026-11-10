"use strict";
const turns = Number(process.argv[2] ?? 60000);
const table = { lay(one, value) { one.mark = value; } };
const way = JSON.parse('"lay"'), name = JSON.parse('"mark"');
class Bare { constructor() { this.n = 1; this.m = 2; } }
const through = new Function("value", "return value");
let laid = 0, fresh = 0;
function tell(value) { return typeof value === "number" ? value : value === undefined ? -1 : -3; }
for (let turn = 0; turn < turns; turn++) {
    const one = through(turn % 5 === 4 ? JSON.parse('{"n":3,"mark":40,"m":4}') : new Bare);
    if (turn % 3 === 1)
        one[name] = 100 + turn % 11;
    const before = tell(one[name]);
    table[way](one, turn % 7);
    const said = before + 3 * tell(one[name]) + tell(one.n) + Object.keys(one).indexOf(name) + Object.keys(one).length;
    if (before === -1)
        fresh = (fresh + said) % 1000003;
    else
        laid = (laid + said) % 1000003;
}
console.log("SAID", laid, fresh);
