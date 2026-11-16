"use strict";
class Leaf { constructor(n) { this.n = n; } weigh(by) { return this.n * by.k; } }
function make(r) { return r % 5 === 0 ? true : r % 5 === 1 ? false : r % 5 === 2 ? null : r % 5 === 3 ? undefined : new Leaf(r); }
const by = { k: 3 };
function tell(list) { let s = ""; for (let i = 0; i < list.length; i++) { const e = list[i]; s += typeof e === "object" && e !== null ? e.weigh(by) : String(e); s += ","; } return s; }
function weighAll(list) { let s = 0; for (let i = 0; i < list.length; i++) { try { s += list[i].weigh(by); } catch (e) { s += 1000; } } return s; }
const kept = [];
function keep(v, r) { if (r & 1) { if (v === true) return; } kept.push(v); }
for (let r = 0; r < Number(process.argv[2] || 25); r++) keep(make(r), r);
console.log(tell(kept), weighAll(kept), by.k);
