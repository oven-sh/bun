// A setter is defined on the prototype between two constructions. Nothing reads the property: the store in the second constructor runs the setter.
"use strict";
const print = text => console.log(text);
let count = 0;
let trail = "";
function note(text) {
  count++;
  trail += text + "; ";
}
function str(v) {
  if (typeof v === "string") return '"' + v + '"';
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return "symbol";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "object" && v !== null) return "object";
  if (v === 0 && 1 / v < 0) return "-0";
  return "" + v;
}
class A {
  constructor() {
    this.a = 1;
    this.k = 2;
    this.z = 3;
  }
  m() {
    return "m";
  }
}
function make() {
  return new A();
}
function run() {
  let seen, before, line;
  const first = make();
  before = count;
  try {
    make();
    seen = "made";
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("first before" + ": " + line);
  try {
    Object.defineProperty(A.prototype, "k", {
      set(v) {
        note("set " + str(v));
      },
      enumerable: true,
      configurable: true,
    });
  } catch (e) {
    note("the change threw " + e.name);
  }
  const second = make();
  before = count;
  try {
    make();
    seen = "made";
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("second" + ": " + line);
  before = count;
  try {
    make();
    seen = "made";
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("first after" + ": " + line);
}
try {
  run();
} catch (e) {
  print("run threw " + e.name);
}
print("end: " + count + " " + trail);
