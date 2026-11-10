"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const helpers = { skip(it) { return it.next().value; } }, name = JSON.parse('"skip"');
function f(t) { const list = [1, 2, 3, 4, 5, t]; const it = list.values(); let out = "", r; while (!(r = it.next()).done) out += r.value + "/" + helpers[name](it) + " "; return out; }
for (let t = 0; t < 3 + more; t++) said.push(f(t));
console.log(said.join("\n"));
