"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
function grows(t) { const list = [1, 2, t]; const it = list.values(); let out = "", r, turns = 0; while (!(r = it.next()).done) { out += r.value + " "; if (turns++ < 2) list.push(10 + turns); } return out; }
function cut(t) { const list = [1, 2, 3, 4, 5, t]; const it = list.values(); let out = "", r; while (!(r = it.next()).done) { out += r.value + " "; if (r.value === 2) list.length = 3; } return out; }
for (let t = 0; t < 3 + more; t++) said.push(grows(t), cut(t));
console.log(said.join("\n"));
