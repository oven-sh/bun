// A read-only member is defined on the prototype of a constructor function before the first construction: the store in the constructor throws.
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
function A() {
  this.a = 1;
  this.k = 2;
  this.z = 3;
}
A.prototype.m = function () {
  return "m";
};
function make() {
  return new A();
}
function run() {
  let seen, before, line;
  try {
    Object.defineProperty(A.prototype, "k", {
      value: "read-only",
      writable: false,
      enumerable: true,
      configurable: true,
    });
  } catch (e) {
    note("the change threw " + e.name);
  }
  const o = make();
  before = count;
  try {
    make();
    seen = "made";
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("after" + ": " + line);
}
try {
  run();
} catch (e) {
  print("run threw " + e.name);
}
print("end: " + count + " " + trail);
