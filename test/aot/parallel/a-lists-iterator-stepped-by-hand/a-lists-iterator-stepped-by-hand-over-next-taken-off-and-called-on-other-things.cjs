"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
const next = parsed("[1]").values().next, list = parsed("[5,6]"), it = list.values();
said.push(String(next.call(it).value), String(next.call(it).value), String(next.call(it).done));
for (const other of [undefined, null, 1, {}, [], new Map().values(), more]) { try { next.call(other); said.push("ran"); } catch (error) { said.push(error.constructor.name); } }
console.log(said.join("\n"));
