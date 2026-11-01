// The read finds the parent's accessor for objects of both classes until the heir gets one of its own, from the same factory.
"use strict";
function flag(bit) {
  return {
    configurable: true,
    get() {
      return (this.bits & bit) !== 0;
    },
    set(value) {
      if (value) this.bits |= bit;
      else this.bits &= ~bit;
    },
  };
}
class Parent {
  constructor(bits) {
    this.bits = bits;
  }
}
class Heir extends Parent {}
Object.defineProperties(Parent.prototype, { open: flag(1) });

function run(states) {
  let sum = 0;
  for (const state of states) sum = sum * 2 + (state.open ? 1 : 0);
  return sum;
}
function store(states, value) {
  for (const state of states) state.open = value;
}
const name = ["op", "en"].join("");
const states = [new Parent(1), new Heir(1), new Parent(2), new Heir(2), new Parent(3), new Heir(3)];
for (let turn = 0; turn < 5000; turn++) (run(states), store(states.slice(6), true));
console.log(run(states));
Object.defineProperty(Heir.prototype, name, flag(2));
console.log(run(states));
store(states, true);
console.log(run(states), states.map(state => state.bits).join());
delete Heir.prototype[name];
store(states, false);
console.log(run(states), states.map(state => state.bits).join());
