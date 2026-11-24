// A file lays its own exports by a getter: whoever requires it gets what the getter answers, a new object each time, and not the empty object that the file began with.
"use strict";
const first = require("./quiet-bell.cjs");
const second = require("./quiet-bell.cjs");
console.log(Object.keys(first).join(), typeof first.ring, String(first.ring(1, 2)), first.stop === second.mute);
console.log(first === second, first.number === second.number, first.number > 0, first.made >= second.number);
function heard(times) {
  let sum = 0;
  for (let at = 0; at < times; at++) {
    const bell = require("./quiet-bell.cjs");
    if (bell.ring(at) === undefined) sum += bell === first ? 100 : 1;
  }
  return sum;
}
console.log(heard(5), heard(0));
const loud = require("./loud-bell.cjs");
console.log(loud.early, loud.late, loud.ring(), loud.ring(), loud.rings, require("./loud-bell.cjs") === loud, Object.keys(loud).join());
const descriptor = Object.getOwnPropertyDescriptor(loud, "rings");
console.log(typeof descriptor.get, descriptor.enumerable);
