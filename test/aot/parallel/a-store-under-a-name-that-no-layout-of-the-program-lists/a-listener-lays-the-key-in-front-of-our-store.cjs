"use strict";
const { EventEmitter } = require("node:events");
const turns = Number(process.argv[2] ?? 60000);
const table = { lay(one, value) { one.mark = value; } };
const way = JSON.parse('"lay"'), name = JSON.parse('"mark"');
class Bare { constructor() { this.n = 1; this.m = 2; } }
const through = new Function("value", "return value");
const bell = new EventEmitter;
bell.on("made", new Function("name", "return function (one, value) { one[name] = value; }")(name));
let laid = 0, fresh = 0;
function tell(value) { return typeof value === "number" ? value : value === undefined ? -1 : -3; }
for (let turn = 0; turn < turns; turn++) {
    const one = through(new Bare);
    if (turn % 3 !== 2)
        bell.emit("made", one, 100 + turn % 11);
    const before = tell(one[name]);
    table[way](one, turn % 7);
    const said = before + 3 * tell(one[name]) + tell(one.m) + Object.keys(one).indexOf(name) + Object.keys(one).length;
    if (before === -1)
        fresh = (fresh + said) % 1000003;
    else
        laid = (laid + said) % 1000003;
}
console.log("SAID", laid, fresh);
