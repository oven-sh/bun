"use strict";
class Other { constructor() { this.port = 2; this.more = 3; } }
class Counter { constructor() { this.port = 1; } step(i) { this.port = i; } }
const counter = new Counter(), holders = JSON.parse('[{"port":5},null]'), turns = JSON.parse("40");
holders[1] = counter; globalThis.kept = new Other();
function sum(holder, n) { let s = 0; for (let i = 0; i < n; i++) { s += holder.port * 2; counter.step(i); } return s; }
const found = { sum }[JSON.parse('"sum"')];
let all = 0;
for (let t = 0; t < 2000; t++) all += found(holders[t & 1], turns);
console.log(all, found(holders[0], turns), found(holders[1], turns));
