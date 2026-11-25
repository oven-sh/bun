"use strict";
class Knob { constructor(step) { this.step = step; this.early = this.turn(1); const inner = this.turn; this.turn = by => inner.call(this, by) + 1000; this.behind = this.turn(1); } turn(by) { return by + this.step; } }
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) { const knob = new Knob(i); s = (s + knob.early + knob.behind + knob.turn(i)) | 0; } return s; }
console.log(drive(+(process.argv[2] ?? 50)));
