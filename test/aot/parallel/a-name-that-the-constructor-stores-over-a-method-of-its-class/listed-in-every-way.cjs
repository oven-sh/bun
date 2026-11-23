"use strict";
class Knob { constructor(step) { this.first = 1; this.turn = this.turn.bind(this); this.step = step; } turn(by) { return by + this.step; } }
const knob = new Knob(+(process.argv[2] ?? 50)); knob.late = 2;
const names = []; for (const name in knob) names.push(name);
const described = Object.getOwnPropertyDescriptor(knob, "turn");
console.log(Object.keys(knob).join(), names.join(), JSON.stringify(knob), Object.keys({ ...knob }).join(), Object.getOwnPropertyNames(knob).join(), Reflect.ownKeys(knob).join());
console.log(typeof described.value, described.writable, described.enumerable, described.configurable, Object.hasOwn(knob, "turn"), knob.turn === Knob.prototype.turn, knob.turn.name, knob.turn(1));
