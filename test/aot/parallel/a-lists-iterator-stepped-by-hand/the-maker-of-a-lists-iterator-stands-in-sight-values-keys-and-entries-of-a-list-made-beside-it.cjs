"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
function values(t) { const list = [4, 5, 6, t]; const it = list.values(); let out = "", r; while (!(r = it.next()).done) out += r.value + " "; return out; }
function keys(t) { const list = [4, 5, 6, t]; const it = list.keys(); let out = "", r; while (!(r = it.next()).done) out += r.value + " "; return out; }
function entries(t) { const list = [4, 5, 6, t]; const it = list.entries(); let out = "", r; while (!(r = it.next()).done) out += r.value[0] + ":" + r.value[1] + " "; return out; }
function bySymbol(t) { const list = ["a", "b", t]; const it = list[Symbol.iterator](); let out = "", r; while (!(r = it.next()).done) out += r.value + " "; return out; }
for (let t = 0; t < 3 + more; t++) said.push(values(t), keys(t), entries(t), bySymbol(t));
console.log(said.join("\n"));
