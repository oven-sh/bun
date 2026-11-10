"use strict";
function go(g, k) { const c = g.cells; let s = 0; for (let i = 0; i < c.length; i++) if (c[i] === 3) s += k; return s; }
const found = { go }[JSON.parse("\"go\"")];
class Grid { constructor(n) { this.cells = new Float64Array(n).fill(3); } }
class Whole extends Grid { constructor(n) { super(n); this.cells = new Int32Array(n + 1).fill(3); } }
for (let round = 0; round < 3; round++) console.log(found(new Grid(4), 2), found(new Whole(4), 2));
