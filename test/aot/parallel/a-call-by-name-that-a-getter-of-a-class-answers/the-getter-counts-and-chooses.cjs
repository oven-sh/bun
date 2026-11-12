"use strict";
let asked = 0;
const up = by => by + 1, down = by => by - 1;
class Gauge { get read() { asked++; return asked % 3 ? up : down; } }
const gauge = new Gauge();
function once(by) { return gauge.read(by); }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const before = asked; s = (s + once(i) + (asked - before) * 100) | 0; } return s; }
console.log(drive(+(process.argv[2] ?? 50)), asked);
