"use strict";
class Meter { constructor(step) { this.step = step; this.total = 0; } count(value) { this.total += value * this.step; return this.total; } }
const first = new Meter(3), second = new Meter(5);
const count = first.count.bind(first);
let other = first.count.bind(second);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + count(i & 7) + other(i & 3)) | 0; return s; }
const turns = +(process.argv[2] ?? 50); console.log(drive(turns), first.total, second.total); other = v => v; console.log(drive(turns), first.total, second.total); other = Meter.prototype.count.bind({ step: 1, total: 100 }); console.log(drive(turns), first.total, second.total);
