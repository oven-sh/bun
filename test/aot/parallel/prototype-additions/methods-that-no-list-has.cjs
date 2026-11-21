// The global object is let go, so evaluated text may come by every prototype. A method is called on what is an instance, a list or a primitive: no list has it, and the call throws.
"use strict";
const all = globalThis;
class Step {
  constructor(far, up) {
    this.far = far;
    this.up = up;
  }
  added(other) {
    return new Step(this.far + other.far, this.up + other.up);
  }
  size() {
    return Math.abs(this.far) + Math.abs(this.up);
  }
}
function sizeOf(one) {
  return one.size();
}
function sum(list) {
  let made = new Step(0, 0);
  for (const one of list) made = made.added(one);
  return made;
}
function tried(one) {
  try {
    return String(sizeOf(one));
  } catch (error) {
    return error.constructor.name;
  }
}
let count = 0;
for (let round = 0; round < 200; round++) count += sum([new Step(round, 1), new Step(2, -round)]).size() + sizeOf(new Step(1, round));
console.log(count);
const others = [[], [1, 2], "text", 5, true, null, undefined, {}, () => 1, new Map([[1, 2]]), new Set([1]), Object.create(Step.prototype), 4n, Symbol.iterator, new (class extends Array {})(), [new Step(1, 2)]];
console.log(others.map(tried).join());
console.log(typeof all.Array, all.eval("typeof Array.prototype.size"), (0, eval)("[].size === undefined"));
class Sized extends Array {
  size() {
    return this.length * 10;
  }
}
console.log(tried(Sized.from([1, 2, 3])), tried(Object.assign([], { size: () => "own" })), tried({ size: () => "literal" }), tried(Object.assign(() => 1, { size: () => "function" })));
try {
  sum([new Step(1, 1), [2, 3]]);
} catch (error) {
  console.log(error.constructor.name);
}
console.log(String(sum([{ far: 4, up: "5" }]).up), tried(sum([[1, 2]])), sum([]).size());
