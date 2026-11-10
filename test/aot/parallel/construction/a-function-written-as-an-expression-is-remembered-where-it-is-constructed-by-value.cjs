// A function written as an expression, of which no `new` by name and no `.prototype` is in sight, has no layout and no entry that allocates: `new` of a value that holds it asks the run time for `this`.
// What the run time found was remembered in the rare data of a function of the engine, and such a callee is none: every birth read the prototype by name and asked the cache of structures under its lock.
// It is remembered beside the callee now. The memory is wiped at each collection, so the slow road runs about once a collection and not once a birth.
// COUNTER: ThisMadeBySlowOperation <= 6400
"use strict";
const holders = { plain: function () { }, storing: function (x, y) { this.x = x; this.y = y; } }, keys = JSON.parse('["plain","storing"]');
let sum = 0;
for (let turn = 0; turn < 32000; turn++) {
  const empty = new holders[keys[0]](), filled = new holders[keys[1]](turn, 2);
  sum = (sum + filled.x + filled.y + Object.keys(empty).length) % 1000003;
}
console.log(sum);
