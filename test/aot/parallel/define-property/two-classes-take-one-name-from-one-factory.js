// Two classes have an accessor under one name, both function objects of one function, and each tests another bit. One read meets objects of both.
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
function Reader(bits) {
  this.bits = bits;
}
function Writer(bits) {
  this.bits = bits;
}
Object.defineProperties(Reader.prototype, { ended: flag(1), busy: flag(4) });
Object.defineProperties(Writer.prototype, { ended: flag(2), busy: flag(8) });

function run(states, turn) {
  let text = "";
  for (const state of states) {
    text += state.ended ? "y" : "n";
    state.ended = turn++ & 4;
    text += state.bits.toString(16) + (state.busy ? "B" : "b");
  }
  return text;
}
const states = [];
for (let i = 0; i < 24; i++) states.push(i % 3 ? new Reader(i & 15) : new Writer(i & 15));
let text;
for (let turn = 0; turn < 2000; turn++) text = run(states, turn);
console.log(text);
