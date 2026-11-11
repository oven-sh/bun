"use strict";
function named(by) { return by + this.name.length; }
class Gauge { static get read() { return named; } }
class Dial extends Gauge {}
class Other extends Gauge { static get read() { return by => -by; } }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + Gauge.read(i) + Dial.read(i) + Other.read(i)) | 0; return s; }
console.log(drive(+(process.argv[2] ?? 50)));
