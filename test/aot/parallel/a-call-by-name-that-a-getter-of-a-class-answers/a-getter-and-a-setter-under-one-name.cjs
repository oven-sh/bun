"use strict";
class Gauge { constructor() { this.kept = by => by + 1; } get read() { return this.kept; } set read(value) { this.kept = value; } }
const gauge = new Gauge();
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { if (i === turns >> 1) gauge.read = by => by * 3; s = (s + gauge.read(i)) | 0; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
