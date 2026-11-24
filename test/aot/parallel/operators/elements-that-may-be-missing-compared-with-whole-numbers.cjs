// Elements that may be missing, holes, values of every kind are compared with whole numbers, kept, narrowed and counted.
"use strict";
const out = [], id = x => [x][JSON.parse("0")];
class Grid { constructor() { this.cells = new Array(12).fill(0); this.heights = new Array(4).fill(0); } at(i) { return this.cells[i]; } count(p) { let n = 0; for (let i = 0; i < 14; i++) { const c = this.cells[i]; if (c === p) n++; else if (c !== 0) n += 100; } return n; } }
const lists = () => [[1, 2, 3], [1.5, 2, 3], [1, , 3], [undefined, null, 2], ["2", 2, true], [2n, 2], [-0, 0, 1], [4294967296, 2147483647, -2147483648], [NaN, 2], [], Object.freeze([2, 1])];
function tell(l, i, k) { let s = ""; if (l[i] === k) s += "a"; if (k === l[i]) s += "b"; if (l[i] !== k) s += "c"; const v = l[i]; if (v === k) s += typeof v + (v + 1); else s += String(v); return s; }
for (let r = 0; r < 25; r++) {
  out.length = 0;
  const g = new Grid(); for (let i = 0; i < 12; i += 3) g.cells[i] = i & 1 ? 1 : 2;
  out.push(g.count(1), g.count(2), g.count(0), g.at(20) === 0, g.at(2) === 0);
  for (const l of lists()) for (const i of [0, 1, 2, 5, -1]) for (const k of [0, 1, 2, -0, 2147483647, -2147483648]) out.push(tell(l, i, k), tell(id(l), id(i), id(k)));
  g.cells[3] = 2.5; g.cells[4] = "x"; out.push(g.count(2), g.heights[1] === 0, g.heights[9] === 0);
}
let h = 7; for (const c of out.join("|")) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(out.length, h, out.slice(0, 5).join());
