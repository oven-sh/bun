// The loop has read the accessor many times when the class gets another function object of the same function under the name.
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

function run(states, change) {
  let text = "";
  for (const state of states) {
    text += state.open ? "y" : "n";
    if (change && state.bits === 5) change();
    state.open = !state.busy;
    text += state.bits;
  }
  return text;
}
function make() {
  const states = [];
  for (let bits = 1; bits < 9; bits++) states.push(new State(bits));
  return states;
}
for (let turn = 0; turn < 4000; turn++) run(make());
console.log(run(make()));
console.log(run(make(), () => Object.defineProperty(State.prototype, "open", flag(2))));
console.log(
  run(make(), () =>
    Object.defineProperty(State.prototype, "open", Object.getOwnPropertyDescriptor(State.prototype, "busy")),
  ),
);
console.log(run(make(), () => Object.defineProperty(State.prototype, "open", flag(8))));
console.log(
  run(make(), () => Object.defineProperty(State.prototype, "open", { value: 0, writable: true, configurable: true })),
);
console.log(run(make(), () => delete State.prototype.open));
console.log(run(make()));
