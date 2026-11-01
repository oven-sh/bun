// Both names hold function objects of one function, so the class looks as it was written, and each name answers for the other's bit.
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
function State(bits) {
  this.bits = bits;
}
Object.defineProperties(State.prototype, { open: flag(1), busy: flag(2) });
const names = ["open", "busy"];
const [open, busy] = names.map(name => Object.getOwnPropertyDescriptor(State.prototype, name));
Object.defineProperty(State.prototype, names[0], busy);
Object.defineProperty(State.prototype, names[1], open);

function run(states) {
  let sum = 0;
  for (const state of states) sum += (state.open ? 10 : 0) + (state.busy ? 1 : 0);
  return sum;
}
const states = [0, 1, 2, 3].map(bits => new State(bits));
let sum = 0;
for (let turn = 0; turn < 5000; turn++) sum += run(states);
states[0].open = true;
console.log(sum, states[0].bits, run([states[1]]), run([states[2]]));
