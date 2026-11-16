"use strict";
function go(g, k) { const c = g.cells; let s = 0; for (let i = 0; i < c.length; i++) if (c[i] === 3) s += k; return s; }
const found = { go }[JSON.parse("\"go\"")];
class Grid { constructor(kind) { if (kind) this.cells = new Float64Array(4).fill(3); else this.cells = [3, 1, "3", 3]; } }
for (let round = 0; round < 3; round++) console.log(found(new Grid(true), 2), found(new Grid(false), 2));
