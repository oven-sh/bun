// One object gets an accessor of its own from the same factory, another gets a prototype that has one.
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
  let text = "";
  for (const state of states) {
    text += state.open ? "y" : "n";
    state.open = !state.open;
    text += state.bits;
  }
  return text;
}
const name = ["op", "en"].join("");
const states = [6, 6, 6, 7].map(bits => new State(bits));
for (let turn = 0; turn < 5000; turn++) run(states);
console.log(run(states));
Object.defineProperty(states[1], name, flag(2));
console.log(run(states));
Object.setPrototypeOf(states[2], Object.defineProperty({}, name, flag(4)));
console.log(run(states));
states.push(Object.create(State.prototype, { [name]: flag(2), bits: { value: 6, writable: true } }));
console.log(run(states), run(states));
