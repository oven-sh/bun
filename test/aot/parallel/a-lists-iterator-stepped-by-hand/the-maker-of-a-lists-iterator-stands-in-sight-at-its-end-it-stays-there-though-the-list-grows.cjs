"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
function f(t) { const list = [1, t]; const it = list.values(); let out = "", r; while (!(r = it.next()).done) out += r.value + " "; list.push(5, 6); out += it.next().done + " " + it.next().done + " "; for (const x of list) out += x; return out; }
for (let t = 0; t < 3 + more; t++) said.push(f(t));
console.log(said.join("\n"));
