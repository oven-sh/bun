// A bigint literal names a property of a binding pattern and of an assignment pattern by its decimal digits, never by the name of its target.
const source = { 1: "one", 2: "two", x: "wrong x", y: "wrong y", z: "wrong z" };

const { 1n: a, 2n: b = "unused default", 3n: c = "default" } = source;
console.log(a, b, c);

let x, y, z;
({ 1n: x, 2n: y = "unused default", 3n: z = "default" } = source);
console.log(x, y, z);

const { 1n: first, ...others } = source;
console.log(first, JSON.stringify(others));

let assignedFirst, assignedOthers;
({ 1n: assignedFirst, ...assignedOthers } = source);
console.log(assignedFirst, JSON.stringify(assignedOthers));

function parameters({ 2n: second }) {
  return second;
}
console.log(parameters(source));

for (const nullish of [null, undefined]) {
  try {
    ({ 1n: x } = nullish);
  } catch (error) {
    console.log(error.name);
  }
}
