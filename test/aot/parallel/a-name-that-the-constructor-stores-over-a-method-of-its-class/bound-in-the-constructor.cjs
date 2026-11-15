"use strict";
class Knob { constructor(step) { this.step = step; this.turn = this.turn.bind(this); } turn(by) { return (by + this.step) & 255; } }
const knob = new Knob(3), loose = knob.turn;
function drive(t, turns) { let s = t & 1; for (let i = 0; i < turns; i++) s = (s + loose(i) + knob.turn(i)) | 0; return s; }
const turns = +(process.argv[2] ?? 50); let all = 0; for (let t = 0; t < turns; t++) all = (all + drive(t, turns)) % 1000003; console.log(all);
