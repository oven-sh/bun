"use strict";
class Knob { constructor(step) { this.step = step; this.turn = this.turn.bind(this); } turn(by) { return by + this.step; } }
class Dial extends Knob { constructor(step) { super(step); this.scale = 2; } turn(by) { return super.turn(by) * (this.scale ?? 7); } }
function drive(knob, turns) { let s = 0; const loose = knob.turn; for (let i = 0; i < turns; i++) s = (s + loose(i) + knob.turn(i)) | 0; return s; }
const turns = +(process.argv[2] ?? 50); console.log(drive(new Knob(3), turns), drive(new Dial(3), turns), drive(new Knob(4), turns), Object.keys(new Dial(1)).join());
