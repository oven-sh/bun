// `State.prototype = { .. }`: the objects made before and behind it have one constructor and find function objects of one function, which test different bits.
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
Object.defineProperties(State.prototype, { open: flag(1) });

function run(states) {
  let sum = 0;
  for (const state of states) sum = sum * 2 + (state.open ? 1 : 0);
  return sum;
}
const states = [new State(1), new State(2), new State(3)];
for (let turn = 0; turn < 5000; turn++) run(states);
console.log(run(states));
const key = ["proto", "type"].join("");
State[key] = Object.defineProperties({}, { open: flag(2) });
states.push(new State(1), new State(2), new State(3));
for (let turn = 0; turn < 5000; turn++) run(states);
states[0].open = false;
states[3].open = true;
console.log(run(states), states.map(state => state.bits).join());
