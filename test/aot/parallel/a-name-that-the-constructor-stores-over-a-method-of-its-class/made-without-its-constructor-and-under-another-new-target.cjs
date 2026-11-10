"use strict";
class Knob { constructor(step) { this.step = step; this.turn = this.turn.bind(this); } turn(by) { return by + this.step; } }
class Other { turn(by) { return -by; } }
const turns = +(process.argv[2] ?? 50);
function drive(knob) { let s = 0; for (let i = 0; i < turns; i++) s = (s + knob.turn(i)) | 0; return s; }
const bare = Object.create(Knob.prototype); bare.step = 5;
const crossed = Reflect.construct(Knob, [6], Other);
console.log(drive(new Knob(1)), drive(bare), Object.keys(bare).join(), drive(crossed), crossed instanceof Other, crossed instanceof Knob, Object.keys(crossed).join());
