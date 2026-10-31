// `state.busy = true`, where the setter came out of `flag(2)`: in a hot loop the store takes the function object from where the class has it and calls the function directly.
// COUNT: arrivals <= 200
"use strict";
function flag(bit) {
  return {
    get() {
      return (this.bits & bit) !== 0;
    },
    set(value) {
      if (value) this.bits |= bit;
      else this.bits &= ~bit;
    },
  };
}
function State() {
  this.bits = 0;
}
Object.defineProperties(State.prototype, { open: flag(1), busy: flag(2), done: flag(4) });

function run(states, turn) {
  let sum = 0;
  for (const state of states) {
    state.open = turn & 1;
    state.busy = turn & 2;
    state.done = !state.open;
    sum += state.bits;
    turn++;
  }
  return sum;
}
const states = [];
for (let i = 0; i < 64; i++) states.push(new State());
let sum = 0;
for (let turn = 0; turn < 2000; turn++) sum += run(states, turn);
console.log(sum, states[5].bits, states[5].open, states[5].busy, states[5].done);
