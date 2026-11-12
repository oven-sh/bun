"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const list = parsed("[1,2,3]"), it = list.values(), out = [];
for (let k = 0; k < 12 + more; k++) { const r = it.next(); out.push(r.done ? "end" : r.value); if (r.done) break; if (k < 3) list.push(10 + k); if (k === 4) list.length = 5; }
said.push(out.join(" "));
console.log(said.join("\n"));
