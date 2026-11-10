// Forty classes that come out of run-time text stand below one compiled base, whose constructor makes the objects of all of them: its own cell below forty prototypes. Behind the first of each the run time is not asked again, but where an allocator has run dry or a collection has come between.
// COUNT: operation:operationAOTSetConstructPrototype <= 4000
"use strict";
class Base { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + 1 + work; } }
const classes = [];
for (let k = 0; k < 40; k++) classes.push(new Function("Base", `return class K${k} extends Base { constructor(n) { super(n); this.k${k % 7} = n + ${k}; } }`)(Base));
let sum = 0, wrong = 0;
for (let turn = 0; turn < 90000; turn++) {
  const Class = classes[turn % 40];
  const one = new Class(turn);
  if (Object.getPrototypeOf(one) !== Class.prototype) wrong++;
  sum += one.size + one["k" + ((turn % 40) % 7)];
}
console.log(sum, wrong);
