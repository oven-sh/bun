"use strict";
class Leaf { constructor(n) { this.tag = n; this.flag = n > 1 ? true : { n }; } }
const kept = [];
let last = 0;
function keep(v) { const tag = v.tag, flag = v.flag; if (v === true) kept.push(flag); else kept.push(tag); last = r0(tag, flag); }
function r0(a, b) { return a === undefined ? b : a; }
const say = [() => typeof last], z = JSON.parse("0");
let out = "";
for (let r = 0; r < 4; r++) { keep(r & 1 ? new Leaf(r) : true); out += say[z]() + ","; }
console.log(out, kept.length);
