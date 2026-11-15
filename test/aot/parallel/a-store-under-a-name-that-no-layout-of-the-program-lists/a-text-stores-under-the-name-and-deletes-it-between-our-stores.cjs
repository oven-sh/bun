"use strict";
const turns = Number(process.argv[2] ?? 60000);
function lay(one, value) { one.mark = value; }
class Bare { constructor() { this.n = 1; this.m = 2; } }
const through = new Function("value", "return value");
const laysToo = new Function("one", "value", "one.mark = value + 100;"), takes = new Function("one", "delete one.mark;");
const all = [through(new Bare), through(new Bare), through(new Bare)];
let sum = 0;
function tell(value) { return typeof value === "number" ? value : value === undefined ? -1 : -3; }
for (let turn = 0; turn < turns; turn++) {
    const one = through(all[turn % all.length]);
    if (turn % 5 === 0) laysToo(one, turn % 7); else if (turn % 11 === 0) takes(one); else lay(one, turn % 7);
    sum = (sum + tell(one.mark) + tell(one.n) + Object.keys(one).length) % 1000003;
}
console.log("SAID", sum);
