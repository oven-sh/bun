// One list of the names of the file serves the text in a function, an arrow, a method, a field, a loop, under a try and at the top of the file.
import path, { join as joined, sep } from "node:path";
import * as whole from "node:path";

function early(text) {
  return eval(text);
}
const describe = run => {
  try {
    return run();
  } catch (error) {
    return `${error.constructor === ReferenceError ? "ReferenceError" : error.constructor === TypeError ? "TypeError" : "other"}`;
  }
};
console.log(
  describe(() => early("late")),
  describe(() => early("late = 1")),
  describe(() => early("typeof late")),
);
console.log(
  describe(() => early("typeof Later")),
  describe(() => early("hoisted()")),
  describe(() => early("typeof neverDeclared")),
);

let late = 1;
const fixed = 2;
var old = 3;
class Later {
  field = eval("late + fixed + old");
  static made = eval("late * 10");
  method(text) {
    return eval(text);
  }
  static arrow = text => eval(text);
}
function hoisted() {
  return "hoisted";
}
export default function spelled() {
  return "spelled";
}

console.log(early("late"), early("(fixed)"), early("old"), new Later().field, Later.made);
console.log(
  describe(() => early("fixed = 5")),
  fixed,
  describe(() => early("neverDeclared")),
  describe(() => early("delete late")),
);
console.log(
  early("late = 4; late"),
  late,
  new Later().method("old = late + 1; old"),
  old,
  Later.arrow("late += 1"),
  late,
);
console.log(early("spelled()"), early("(spelled)") === spelled, early("hoisted") === hoisted, early("Later") === Later);
console.log(
  early("joined('a', 'b')") === `a${sep}b`,
  early("path.sep") === sep,
  early("whole.sep") === sep,
  early("sep") === sep,
);
console.log(
  describe(() => early("joined = 1")),
  describe(() => early("whole = 1")),
);

const kept = early("() => ++late");
console.log(kept(), kept(), late);

let inLoop = 0;
for (let turn = 0; turn < 3; turn++) inLoop += eval("late = late + turn; late");
console.log(inLoop, late);

function underTry(text) {
  try {
    eval(text);
    throw new Error("thrown");
  } catch {
    return late;
  }
}
console.log(underTry("late = 100"), late);
console.log(eval("late + fixed + old"), eval("late = -1; late"), late, (0, eval)("typeof late"));
