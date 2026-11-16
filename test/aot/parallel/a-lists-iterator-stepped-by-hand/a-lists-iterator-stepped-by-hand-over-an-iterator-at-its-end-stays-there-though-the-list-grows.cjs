"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const list = parsed("[1,2]"), it = list.values();
said.push(drain(it, 9 + more)); list.push(3, 4); said.push(drain(it, 9), drain(it, 9), drain(list.values(), 9));
console.log(said.join("\n"));
