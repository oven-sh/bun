"use strict";
class Gauge { get read() { return by => by + 1; } }
class WithMethod extends Gauge { read(by) { return by + 10; } }
class WithField extends Gauge { constructor() { super(); Object.defineProperty(this, "read", { value: by => by + 100, writable: true, configurable: true, enumerable: true }); } }
class WithGetter extends Gauge { get read() { const above = super.read; return by => above(by) * 2; } }
function drive(gauge, turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + gauge.read(i)) | 0; return s; }
const turns = +(process.argv[2] ?? 50);
console.log(drive(new Gauge(), turns), drive(new WithMethod(), turns), drive(new WithField(), turns), drive(new WithGetter(), turns));
