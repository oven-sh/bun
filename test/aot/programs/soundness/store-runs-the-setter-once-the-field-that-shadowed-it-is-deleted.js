// A field shadows the accessor of its class. Nothing reads the property: once the field is deleted, a store runs the setter.
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
  get k() {
    note("get above");
    return "got above";
  }
  set k(v) {
    note("set above " + str(v));
  }
}
function make() {
  return new A();
}
function run() {
  let seen, before, line;
  const o = make();
  before = count;
  try {
    o.k = 5;
    seen = "stored";
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("before" + ": " + line);
  try {
    note("deleted " + delete o.k);
  } catch (e) {
    note("the change threw " + e.name);
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
  print("after" + ": " + line);
}
try {
  run();
} catch (e) {
  print("run threw " + e.name);
}
print("end: " + count + " " + trail);
