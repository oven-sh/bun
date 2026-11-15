"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const list = parsed("[1,2,3,4,5]"); Object.defineProperty(list, 1, { get() { list.length = 3; return "cut"; } });
said.push(drain(list.values(), 9 + more), String(list.length));
console.log(said.join("\n"));
