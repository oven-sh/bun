// The object is put into a Map, taken out again, and its property becomes an accessor. Nothing reads the property: a store through the first variable runs the setter.
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
function make() {
  return {
    m() {
      return "m";
    },
    a: 1,
    k: 2,
    z: 3,
  };
}
function run() {
  let seen, before, line;
  const o = make();
  const table = new Map();
  table.set("held", o);
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
    Object.defineProperty(table.get("held"), "k", {
      get() {
        note("get");
        return "got";
      },
      set(v) {
        note("set " + str(v));
      },
      enumerable: true,
      configurable: true,
    });
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
