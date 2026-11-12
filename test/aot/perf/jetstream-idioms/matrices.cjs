// A matrix in a field, beside a matrix that extends Array.
class Field { constructor(r, c) { this.d = []; for (var i = 0; i < r; i++) { this.d.push([]); for (var j = 0; j < c; j++) this.d[i].push(0.5); } this.rows = r; } set(i, j, v) { this.d[i][j] = v; return this; } get(i, j) { return this.d[i][j]; } }
var field = new Field(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) field.set(i, j, i * 4 + j + 0.5);
class Extended extends Array { constructor(r, c) { super(r); for (var i = 0; i < r; i++) this[i] = new Array(c); this.rows = r; } set(i, j, v) { this[i][j] = v; return this; } get(i, j) { return this[i][j]; } }
var extended = new Extended(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) extended.set(i, j, i * 4 + j + 0.5);
function mixin(S) { return class extends S { get cols() { return this.columns; } }; }
class Mixed extends mixin(Array) { constructor(r, c) { super(r); for (var i = 0; i < r; i++) this[i] = new Array(c); this.rows = r; } set(i, j, v) { this[i][j] = v; return this; } get(i, j) { return this[i][j]; } }
var mixed = new Mixed(4, 4); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) mixed.set(i, j, i * 4 + j + 0.5);
const loops = {
  "in a field": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += field.get(i & 3, (i >> 2) & 3); field.set(i & 3, 1, s * 0.5); } return s; },
  "a class that extends Array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += extended.get(i & 3, (i >> 2) & 3); extended.set(i & 3, 1, s * 0.5); } return s; },
  "a class that extends a mixin of Array": n => { var s = 0; for (var i = 0, end = n | 0; i < end; i++) { s += mixed.get(i & 3, (i >> 2) & 3); mixed.set(i & 3, 1, s * 0.5); } return s; },
};
const [, loop, iterations] = process.argv.slice(2);
if (loop === undefined) for (const name of Object.keys(loops)) console.log(name, loops[name](40));
else console.log(loops[loop](Number(iterations)));
