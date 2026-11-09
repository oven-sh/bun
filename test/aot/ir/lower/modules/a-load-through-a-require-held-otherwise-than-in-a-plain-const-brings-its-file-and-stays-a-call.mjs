// RUN: link
// CHECK-NOT: path="/$bunfs/root/mixed.cjs"
// CHECK-NOT: path="/$bunfs/root/each.cjs"
// CHECK: module {{*}}path="/$bunfs/root/returned.cjs"
// CHECK: module {{*}}path="/$bunfs/root/stored.cjs"
// CHECK: module {{*}}path="/$bunfs/root/chosen.cjs"
// CHECK-NOT: path="/$bunfs/root/mixed.cjs"
// CHECK-NOT: path="/$bunfs/root/each.cjs"
// CHECK: module {{*}}path="node:module"

// FILE: main.mjs
// A require that the file made for itself is held otherwise than in a plain const: it is the answer of a function with one return, every store to a variable, one side of a choice whose
// other side is nothing. The build finds such a load late: it brings the file and leaves the call an ordinary call, so the require of the run answers, with its cache and its hooks.
// Another function in the variable, or a loop that fills the name, brings nothing.
import { createRequire } from "node:module";
const get = () => createRequire(import.meta.url);
let held;
const chosen = globalThis.flag ? createRequire(import.meta.url) : undefined;
let mixed = createRequire(import.meta.url);
mixed = globalThis.other;
export function returned() {
  return get()("./returned.cjs");
}
export function madeAtTheFirstCall() {
  held ??= createRequire(import.meta.url);
  return held("./stored.cjs");
}
export function oneSideOfAChoice() {
  return chosen("./chosen.cjs");
}
export function besideAnotherFunction() {
  return mixed("./mixed.cjs");
}
export function filledByALoop() {
  for (let each of globalThis.others) {
    each("./each.cjs");
    each = createRequire(import.meta.url);
  }
}

// FILE: returned.cjs
module.exports = 1;

// FILE: stored.cjs
module.exports = 2;

// FILE: chosen.cjs
module.exports = 3;

// FILE: mixed.cjs
module.exports = 4;

// FILE: each.cjs
module.exports = 5;
