"use strict";

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

class Point {
  x = 1;
  y = 2;
}
class Other {
  a = "a";
}
class Child extends Point {
  z = 3;
  sum() {
    return this.x + this.y + this.z;
  }
}
function OldParent() {
  this.old = true;
}
function describe(made) {
  return [Object.keys(made).join(), made.sum(), Array.isArray(made), made instanceof Point, made instanceof Child];
}

for (let i = 0; i < 2000; i++) new Child().sum();
const parents = [
  ["the parent it was declared with", Point],
  ["another class", Other],
  ["a constructor function", OldParent],
  ["Array", Array],
  ["Map", Map],
  ["Object", Object],
  ["a function that returns an object", function () { return { returned: true, sum: () => "the sum of what was returned" }; }],
  ["a function that returns a number", function () { return 5; }],
  ["a bound class", Point.bind(null)],
  ["a proxy of the class", new Proxy(Point, { construct(target, list, newTarget) { log.push("construct"); return Reflect.construct(target, list, newTarget); } })],
  ["an arrow function", () => {}],
  ["Function.prototype", Function.prototype],
  ["null", null],
  ["the parent it was declared with, again", Point],
];
for (const [label, parent] of parents) {
  Object.setPrototypeOf(Child, parent);
  attempt("the parent is " + label, () => describe(new Child()));
}
