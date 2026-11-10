"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const list = parsed("[1,2,3,4,5,6]"); delete list[1]; delete list[4];
let reads = 0; const above = Object.create(Array.prototype, { 4: { get() { reads++; return "above " + reads; }, configurable: true } });
said.push(drain(list.values(), 9 + more)); Object.setPrototypeOf(list, above);
said.push(drain(list.values(), 9), drain(list.entries(), 9), String(reads)); delete above[4];
said.push(drain(list.values(), 9));
console.log(said.join("\n"));
