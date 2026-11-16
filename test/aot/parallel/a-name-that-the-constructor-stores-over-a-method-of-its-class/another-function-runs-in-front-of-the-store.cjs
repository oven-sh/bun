"use strict";
const seen = [];
function look(knob, by) { seen.push(typeof knob.turn, Object.hasOwn(knob, "turn"), knob.turn(by)); }
function lay(knob) { if (knob.step > limit) knob.turn = by => -by; }
class Knob { constructor(step) { this.step = step; this.prepare(); look(this, 1); lay(this); this.early = this.turn(2); this.turn = this.turn.bind(this); look(this, 3); } prepare() { this.ready = this.turn(0); } turn(by) { return by + this.step; } }
const limit = +(process.argv[2] ?? 50);
function drive(knob) { let s = 0; const loose = knob.turn; for (let i = 0; i < limit; i++) s = (s + loose(i) + knob.turn(i)) | 0; return s; }
const low = new Knob(limit), high = new Knob(limit + 1);
console.log(drive(low), drive(high), low.ready, low.early, high.ready, high.early, Object.keys(low).join(), Object.keys(high).join(), seen.join());
