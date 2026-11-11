"use strict";
class Leaf { constructor(n) { this.tag = n; } }
const kept = [];
let last = 0;
function keep(v) { const tag = v.tag; if (true !== v) kept.push(tag); last = tag; }
const say = [() => typeof last], z = JSON.parse("0");
let out = "";
for (let r = 0; r < 4; r++) { keep(r & 1 ? new Leaf(r) : true); out += say[z]() + ","; }
console.log(out, kept.length);
