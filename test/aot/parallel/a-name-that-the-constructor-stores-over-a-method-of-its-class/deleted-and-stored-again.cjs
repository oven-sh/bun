"use strict";
class Knob { constructor(step) { this.step = step; this.turn = this.turn.bind({ step: 100 }); } turn(by) { return (by + this.step) & 255; } }
function drive(knob, turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + knob.turn(i)) | 0; return s; }
const turns = +(process.argv[2] ?? 50), knob = new Knob(3), said = [drive(knob, turns)];
said.push(delete knob.turn, drive(knob, turns), Object.keys(knob).join(), "turn" in knob, Object.hasOwn(knob, "turn"));
knob.turn = by => -by; said.push(drive(knob, turns), Object.keys(knob).join());
console.log(said.join(" "));
