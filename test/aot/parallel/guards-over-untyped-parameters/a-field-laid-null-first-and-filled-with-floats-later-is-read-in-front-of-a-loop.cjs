"use strict";
function go(g, k) { const c = g.cells; let s = 0; for (let i = 0; i < c.length; i++) if (c[i] === 3) s += k; return s; }
const found = { go }[JSON.parse("\"go\"")];
class Grid { constructor() { this.cells = null; } fill(n) { this.cells = new Float64Array(n).fill(3); return this; } }
let said; try { said = found(new Grid(), 2); } catch (error) { said = error.name; }
console.log(said, found(new Grid().fill(4), 2), found(new Grid().fill(0), 2));
