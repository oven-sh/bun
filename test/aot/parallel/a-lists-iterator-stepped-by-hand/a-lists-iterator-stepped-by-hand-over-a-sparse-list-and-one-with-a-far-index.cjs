"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const list = parsed("[1,2]"); list[40 + more] = 3; const it = list.values(); let seen = 0, found = 0; for (;;) { const r = it.next(); if (r.done) break; seen++; if (r.value !== undefined) found += r.value; }
said.push(seen + " " + found);
const far = []; far[100000] = 7; const steps = far.keys(); let last = -1; for (;;) { const r = steps.next(); if (r.done) break; last = r.value; } said.push(String(last));
console.log(said.join("\n"));
