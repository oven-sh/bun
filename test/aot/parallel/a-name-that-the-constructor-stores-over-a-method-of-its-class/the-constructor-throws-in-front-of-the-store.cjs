"use strict";
let leaked;
class Knob { constructor(step) { this.step = step; leaked = this; if (step > limit) throw new RangeError("too far"); this.turn = this.turn.bind({ step: 100 }); } turn(by) { return by + this.step; } }
const limit = +(process.argv[2] ?? 50);
function drive(knob, turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + knob.turn(i)) | 0; return s; }
const whole = new Knob(limit); let caught = "none"; try { new Knob(limit + 1); } catch (error) { caught = error.constructor.name; }
console.log(drive(whole, limit), caught, drive(leaked, limit), Object.keys(leaked).join(), Object.hasOwn(leaked, "turn"));
