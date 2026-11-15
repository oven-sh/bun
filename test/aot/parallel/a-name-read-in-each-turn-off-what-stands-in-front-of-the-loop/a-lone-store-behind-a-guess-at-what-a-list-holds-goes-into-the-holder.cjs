"use strict";
class Other { constructor() { this.port = 2; this.more = 3; } }
class Counter { constructor() { this.port = 1; this.only = 0; } step(i) { this.port = i; } }
const counter = new Counter(), holders = JSON.parse('[{"port":5},null]'), turns = JSON.parse("40");
holders[1] = counter; globalThis.kept = new Other();
const writers = [counter];
function sum(holder, n) { const writer = writers[0]; let s = writer.only; for (let i = 0; i < n; i++) { s += holder.port * 2; writer.port = i; } return s; }
const found = { sum }[JSON.parse('"sum"')];
let all = 0;
for (let t = 0; t < 2000; t++) all += found(holders[t & 1], turns);
console.log("SAID", all, found(holders[0], turns), found(holders[1], turns));
const key = JSON.parse('"port"'); let shadow = JSON.parse("1"), again = 0;
function slow(same, n) { let s = 0; for (let i = 0; i < n; i++) { s += (same ? shadow : Reflect.get(holders[0], key)) * 2; shadow = i; } return s; }
for (let t = 0; t < 2000; t++) again += slow((t & 1) === 1, turns);
console.log("SAID", again, slow(false, turns), slow(true, turns));
