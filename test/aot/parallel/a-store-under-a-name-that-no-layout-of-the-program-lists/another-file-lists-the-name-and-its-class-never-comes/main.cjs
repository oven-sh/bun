"use strict";
const turns = Number(process.argv[2] ?? 60000);
const { Listed } = require("./the-other-file.cjs"); if (turns < 0) console.log(new Listed);
function lay(one, value) { one.mark = value; }
class Bare { constructor() { this.n = 1; this.m = 2; } }
const through = new Function("value", "return value");
let sum = 0;
function tell(value) { return typeof value === "number" ? value : value === undefined ? -1 : -3; }
for (let turn = 0; turn < turns; turn++) {
    const one = through(new Bare);
    lay(one, turn % 7);
    sum = (sum + tell(one.mark) + tell(one.n) + Object.keys(one).length) % 1000003;
}
console.log("SAID", sum);
