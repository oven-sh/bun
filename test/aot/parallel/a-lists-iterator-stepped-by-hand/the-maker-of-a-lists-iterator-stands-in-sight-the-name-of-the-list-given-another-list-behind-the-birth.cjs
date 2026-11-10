"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
function f(t) { let list = [1, 2, t]; const it = list.values(); list = [7, 8, 9, 10]; let out = "", r; while (!(r = it.next()).done) out += r.value + " "; return out + list.length; }
for (let t = 0; t < 3 + more; t++) said.push(f(t));
console.log(said.join("\n"));
