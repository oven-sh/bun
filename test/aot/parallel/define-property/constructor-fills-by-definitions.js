// Constructor functions whose objects get all their properties by definitions, through a helper, by themselves, and in other orders; keys are listed.
"use strict";
const list = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) + (d.writable ? "W" : "w") : "()") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ") + " | " + Object.keys(o).join() + " | " + JSON.stringify(o);
function fill(made, turn) {
  Object.defineProperty(made, "b", { value: turn, enumerable: true });
  Object.defineProperty(made, "c", { get() { return turn; }, enumerable: true, configurable: true });
  if (turn % 3 === 1) made.extra = turn;
  Object.defineProperty(made, "y", { value: { turn }, writable: true });
  Object.defineProperty(made, "z", { value: "z" });
}
function fillBackwards(made, turn) {
  Object.defineProperty(made, "z", { value: "z" });
  Object.defineProperty(made, "y", { value: { turn }, writable: true });
  Object.defineProperty(made, "c", { get() { return turn; }, enumerable: true, configurable: true });
  Object.defineProperty(made, "b", { value: turn, enumerable: true });
}
function Handed(turn) { (turn % 4 === 3 ? fillBackwards : fill)(this, turn); }
function Both(turn) { this.first = turn; fill(this, turn); this.last = turn; }
class Instance { constructor(turn) { this.own = turn; fill(this, turn); } }
for (let turn = 0; turn < 12; turn++) {
  console.log(turn, list(new Handed(turn)));
  console.log(turn, list(new Both(turn)));
  console.log(turn, list(new Instance(turn)));
  if (turn === 6) Bun.gc(true);
}
