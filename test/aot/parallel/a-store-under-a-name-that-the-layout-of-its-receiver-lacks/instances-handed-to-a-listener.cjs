"use strict";
const turns = Number(process.argv[2] ?? 60000);
function lay(one, value) { one.mark = value; }
let sum = 0;
function tell(value) { return typeof value === "number" ? value : value === undefined ? -1 : -3; }
const { EventEmitter } = require("node:events");
class Bare { constructor() { this.n = 1; this.m = 2; } }
const emitter = new EventEmitter; let got;
emitter.on("one", one => { got = one; });
for (let turn = 0; turn < turns; turn++) {
    const one = (emitter.emit("one", new Bare), got);
    lay(one, turn % 7);
    sum = (sum + tell(one.mark) + tell(one.n) + Object.keys(one).length) % 1000003;
}
console.log("SAID", sum);
