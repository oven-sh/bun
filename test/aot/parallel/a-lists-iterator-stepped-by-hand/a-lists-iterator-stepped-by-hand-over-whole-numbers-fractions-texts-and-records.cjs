"use strict";
const parsed = text => JSON.parse(text), said = [], more = process.argv.length > 99 ? 1 : 0;
function drain(it, most) { const out = []; for (let k = 0; k < most; k++) { const r = it.next(); out.push(r.done ? "end" : Array.isArray(r.value) ? "[" + r.value.join() + "]" : String(r.value)); if (r.done) break; } return out.join(" "); }
for (const text of ["[1,2,3]", "[1.5,2.5,-0.5]", '["a","b"]', '[{"x":1},null,true]', "[]", "[1,2.5,\"c\"]"]) { const list = parsed(text); said.push(drain(list[Symbol.iterator](), 9 + more), drain(list.keys(), 9), drain(list.entries(), 9)); }
console.log(said.join("\n"));
