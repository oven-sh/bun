"use strict";
function target() {}
Object.defineProperty(target, "mark", { value: 1 });
target.mark = 2;
const held = [target, new Map([[1, 2]])];
function read() {
  return held;
}
if (process.argv.length > 5) console.log(read());
console.log("reached");
