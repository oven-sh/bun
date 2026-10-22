// The length of an array becomes read-only between two calls of push: the second call throws.
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
  const made = [10, 20, 30];
  return made;
}
function run() {
  let seen, before, line;
  const o = make();
  before = count;
  try {
    seen = "pushed " + o.push(40);
  } catch (e) {
    seen = "threw " + e.name;
  }
  line = seen + " | " + (count - before) + " " + trail;
  trail = "";
  print("before" + ": " + line);
  try {
    Object.defineProperty(o, "length", { writable: false });
  } catch (e) {
    note("the change threw " + e.name);
  }
  before = count;
  try {
    seen = "pushed " + o.push(40);
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
