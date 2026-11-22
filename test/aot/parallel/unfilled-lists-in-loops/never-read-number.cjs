"use strict";
// A list in a field is read under computed keys in a loop; the field is never filled, filled late, emptied, deleted or replaced.
const kinds = JSON.parse('[[5, 4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11], [0.5, 1.5, 2.5, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], ["a", 1, 2.5, null, [], {}, [], 7, "b", 9, true, 3, 2, 1, 0, 5, 6]]'); let kind = 0; function make() { return kinds[kind].slice(); }
class Holder { constructor() { this.keys = [3, 1, 2, 0, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15, 14]; this.out = []; if (kinds.length > 5) this.list = make(); }
  fill(k) { if (k === 2) this.list = make(); }
  run(start, n) { let s = 0;  for (let k = 0; k < n; k++) {  s += this.list[this.keys[k]]; } return s; } }
const starts = JSON.parse("[0, 1, 5, 2.5, -1]"); const lines = [];
function once(start, n) { const h = new Holder(); let said; try { said = h.run(start, n); } catch (e) { said = e.constructor.name; } lines.push([kind, start, n, String(said), JSON.stringify(h.list), JSON.stringify(h.out)].join(" ")); }
for (kind = 0; kind < 3; kind++) for (const start of starts) for (const n of [0, 1, 7, 12, 14]) once(start, n);
for (let r = 0; r < 200; r++) { kind = r % 2; const h = new Holder(); try { lines.push(String(h.run(0, 14))); } catch (e) { lines.push(e.constructor.name); } }
console.log(lines.join("\n"));
