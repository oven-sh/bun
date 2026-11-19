"use strict";
function go(g, k) { const c = g.cells; let s = 0; for (let i = 0; i < c.length; i++) if (c[i] === 3) s += k; return s; }
const found = { go }[JSON.parse("\"go\"")];
class Grid { constructor(n) { this.cells = new Float64Array(n).fill(3); } }
const one = new Grid(4);
console.log(found(one, 2));
one.cells = [3, , 3];
console.log(found(one, 2));
one.cells = "3333";
console.log(found(one, 2));
one.cells = new Uint8Array([3, 3, 3, 3, 3]);
console.log(found(one, 2));
