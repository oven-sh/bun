"use strict";
class Leaf { constructor(n) { this.tag = n; this.flag = n > 1 ? true : { n }; } }
const kept = [];
let last = 0;
function keep(v) { const tag = v.tag; if (v !== true) { if (v !== false) kept.push(tag); } last = tag; }
const say = [() => typeof last], z = JSON.parse("0");
let out = "";
for (let r = 0; r < 4; r++) { keep(r === 0 ? true : r === 1 ? false : new Leaf(r)); out += say[z]() + ","; }
console.log(out, kept.length);
