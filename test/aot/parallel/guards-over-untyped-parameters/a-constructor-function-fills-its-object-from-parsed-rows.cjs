"use strict";
const rows = JSON.parse('[{"x":1,"y":2},{"x":3,"y":4},{"x":"5","y":null},{"y":6}]');
function Point(row) { this.x = row.x; this.y = row.y; }
function all() { const out = []; for (let i = 0; i < rows.length; i++) { const p = new Point(rows[i]); out.push(p.x, p.y); } return out.join(); }
for (let t = 0; t < 300; t++) all();
console.log(all());
const copy = new Point(new Point(rows[0]));
console.log(copy.x, copy.y, copy instanceof Point);
try { new Point(undefined); } catch (e) { console.log(e instanceof TypeError, e.message); }
