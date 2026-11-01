// `Object.defineProperties(State.prototype, { open: flag(1), busy: flag(2) })`: every getter is a function object of one function, and which bit it tests lies in the function object.
// A read takes the function object from where the class has it and calls the function directly. It looks no name up.
// COUNT: arrivals <= 200
"use strict";
function flag(bit) {
  return {
    enumerable: false,
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
Object.defineProperties(State.prototype, { open: flag(1), busy: flag(2), done: flag(4) });

function count(states) {
  let open = 0,
    busy = 0,
    done = 0;
  for (const state of states) {
    if (state.open) open++;
    if (state.busy) busy++;
    if (state.done) done++;
  }
  return [open, busy, done].join();
}
const states = [];
for (let i = 0; i < 64; i++) states.push(new State(i));
let last;
for (let turn = 0; turn < 2000; turn++) last = count(states);
console.log(last, states[5].open, states[5].busy, states[5].done);
