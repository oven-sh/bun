"use strict";
class Gauge { constructor(limit) { this.limit = limit; this.asked = 0; } get read() { if (++this.asked > this.limit) throw new RangeError("asked too often"); return by => by + 1; } }
function drive(gauge, turns) { let s = 0, caught = 0; for (let i = 0; i < turns; i++) { try { s = (s + gauge.read(i)) | 0; } catch (error) { caught += error instanceof RangeError ? 1 : 1000; } } return s + " " + caught; }
const turns = +(process.argv[2] ?? 50);
console.log(drive(new Gauge(turns >> 1), turns));
