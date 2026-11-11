"use strict";
function scaled(by) { return (by * this.scale + this.base) | 0; }
class Gauge { constructor(scale) { this.scale = scale; this.base = 1; this.kept = scaled; } get read() { return this.kept; } }
const gauge = new Gauge(3);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + gauge.read(i)) | 0; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
