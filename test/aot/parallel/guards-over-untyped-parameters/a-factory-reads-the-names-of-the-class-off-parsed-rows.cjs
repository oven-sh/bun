"use strict";
const rows = JSON.parse('[{"x":1,"y":2},{"x":3,"y":4},{"x":"5"}]');
class Pair { constructor(x, y) { this.x = x; this.y = y; } static of(o) { return new Pair(o.x, o.y); } }
function make(o) { return new Pair(o.x, o.y); }
function all() { const out = []; for (let i = 0; i < rows.length; i++) { const a = make(rows[i]), b = Pair.of(rows[i]); out.push(a.x, a.y, b.x, b.y); } return out.join(); }
for (let t = 0; t < 300; t++) all();
console.log(all());
const again = make(Pair.of(rows[0]));
console.log(again.x, again.y);
