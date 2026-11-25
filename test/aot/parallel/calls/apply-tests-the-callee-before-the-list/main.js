// Function.prototype.apply with a receiver that is no function: by the specification it throws before it reads the list (steps 2 and 4). Bun reads the list first, and an executable does as Bun does.
"use strict";
const unknown = value => [value][0];
const reads = [];
const list = {
  get length() {
    reads.push("length");
    return 1;
  },
  get 0() {
    reads.push("0");
    return "first";
  },
};
for (const receiver of [undefined, null, 1, "text", {}, []]) {
  try {
    Function.prototype.apply.call(unknown(receiver), undefined, unknown(list));
    console.log("returned");
  } catch (error) {
    console.log(error.constructor.name, "reads:", reads.join());
  }
}
console.log(Function.prototype.apply.call(unknown(value => value), undefined, unknown(list)), "reads:", reads.join());
