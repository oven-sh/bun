// An object is frozen at iteration 150 of a loop that stores to it. Nothing reads the property: every store from then on throws.
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
  a = 1;
  k = 2;
  z = 3;
  m() {
    return "m";
  }
}
function make() {
  return new A();
}
function run() {
  let seen, before, line;
  const o = make();
  let last = "";
  for (let i = 0; i < 300; i++) {
    if (i === 150) {
      try {
        Object.freeze(o);
      } catch (e) {
        note("the change threw " + e.name);
      }
    }
    before = count;
    try {
      o.k = 5;
      seen = "stored";
    } catch (e) {
      seen = "threw " + e.name;
    }
    line = seen + " | " + (count - before) + " " + trail;
    trail = "";
    if (line !== last) {
      print(i + ": " + line);
      last = line;
    }
  }
}
try {
  run();
} catch (e) {
  print("run threw " + e.name);
}
print("end: " + count + " " + trail);
