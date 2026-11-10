"use strict";
class Knob { constructor(step) { this.step = step; this.turn = this.turn.bind(this); } turn(by) { return by + this.step; } }
const turns = +(process.argv[2] ?? 50), said = [];
function drive(knob) { let s = 0; for (let i = 0; i < turns; i++) s = (s + knob.turn(i)) | 0; return s; }
const first = new Knob(1); said.push(drive(first));
Knob.prototype.turn = function (by) { return by * this.step; };
const second = new Knob(2); said.push(drive(first), drive(second));
let stores = 0; Object.defineProperty(Knob.prototype, "turn", { get() { return function (by) { return -by; }; }, set(value) { stores++; }, configurable: true });
const third = new Knob(3); said.push(drive(first), drive(third), stores, Object.hasOwn(third, "turn"));
Object.defineProperty(Knob.prototype, "turn", { value(by) { return by + 7; }, writable: false, configurable: true });
try { new Knob(4); said.push("stored"); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(" "));
