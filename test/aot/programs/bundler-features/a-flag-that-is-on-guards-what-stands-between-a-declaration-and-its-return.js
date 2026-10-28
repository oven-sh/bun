// What a flag that is on guards runs, also between the declaration of a variable and the `return` that gives it back.
import { feature } from "bun:bundle";
let n = 0;
function make() {
  return "made";
}
function f() {
  const t = make();
  if (feature("SOME_FLAG")) {
    n++;
  }
  return t;
}
console.log(f(), n);

function leavesEarly() {
  const t = make();
  if (feature("SOME_FLAG")) return "early";
  return t;
}
console.log(leavesEarly());

function throws() {
  const t = make();
  if (feature("SOME_FLAG")) throw new Error("thrown");
  return t;
}
try {
  console.log(throws());
} catch (error) {
  console.log(error.message);
}

function changesIt() {
  let t = make();
  if (feature("SOME_FLAG")) t = "changed";
  return t;
}
console.log(changesIt());

class Counter {
  x = 0;
  method() {
    const t = make();
    if (feature("SOME_FLAG")) this.x++;
    return t;
  }
}
const counter = new Counter();
console.log(counter.method(), counter.x);

function guardedByAFlagThatIsOff() {
  const t = make();
  if (feature("ANOTHER_FLAG")) {
    n++;
  }
  return t;
}
console.log(guardedByAFlagThatIsOff(), n);
