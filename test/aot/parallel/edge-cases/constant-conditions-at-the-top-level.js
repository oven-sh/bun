// Conditions that the parser knows, at the top level of a file: each value is read once, so `bun run` prints the initializer in its place.
const on = true;
const off = false;
const nothing = null;
function call(value) {
  return value;
}
const text = on ? "kept" : "dropped";
console.log(text);
const number = off ? 1 : 2;
console.log(number);
const template = on ? `kept ${1 + 1}` : `dropped ${2 + 2}`;
console.log(template);
const called = off ? call("dropped") : call("kept");
console.log(called);
const calledFirst = on ? call("kept") : call("dropped");
console.log(calledFirst);
const nested = on ? (off ? "a" : "b") : "c";
console.log(nested);
const nestedTwice = on ? (on ? (off ? "a" : "b") : "c") : "d";
console.log(nestedTwice);
const inBrackets = (on ? "kept" : "dropped");
console.log(inBrackets);
const and = on && "kept";
console.log(and);
const andDropped = off && call("dropped");
console.log(andDropped);
const or = off || "kept";
console.log(or);
const orDropped = on || call("dropped");
console.log(orDropped);
const nullish = nothing ?? "kept";
console.log(nullish);
const literal = true ? "kept" : "dropped";
console.log(literal);
const negated = !on ? "dropped" : "kept";
console.log(negated);
const object = on ? { a: 1 } : { b: 2 };
console.log(object);
const list = off ? [1] : [2, 3];
console.log(list);
const arrow = on ? () => "kept" : () => "dropped";
console.log(arrow());
const member = (on ? { a: { b: "kept" } } : { a: { b: "dropped" } }).a.b;
console.log(member);
let chosen;
if (on) chosen = "kept";
else chosen = "dropped";
console.log(chosen);
if (off) {
  console.log("dropped");
} else {
  console.log("kept");
}
console.log(on ? "kept" : "dropped", off ? "dropped" : "kept");
