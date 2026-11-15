"use strict";
class Leaf { constructor(n) { this.tag = n; this.flag = n > 1 ? true : { n }; } }
const kept = [];
let last = 0;
function keep(v) { const flag = v.flag, n = flag.n; let a = 0; if (flag === true) a = 1; else kept.push(n); last = n; return a; }
const say = [() => typeof last], z = JSON.parse("0");
let out = "";
for (let r = 0; r < 4; r++) { keep(new Leaf(r)); out += say[z]() + ","; }
console.log(out, kept.length);
