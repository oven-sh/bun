// The prototype of the parent class holds a read-only member. Nothing reads the property: a store to an instance of the subclass throws.
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
class Base {
  constructor() {
    this.a = 1;
  }
  m() {
    return "m";
  }
}
class A extends Base {
  constructor() {
    super();
    this.z = 3;
  }
}
Object.defineProperty(Base.prototype, "k", {
  value: "read-only above",
  writable: false,
  enumerable: true,
  configurable: true,
});
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
    o.p0 = 0;
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
