// A proxy becomes the prototype of the object's prototype. Nothing reads the property: a store of an absent name reaches the trap.
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
const grand = { inherited: "grand" };
const parent = Object.create(grand);
parent.m = function () {
  return "m";
};
function make() {
  const made = Object.create(parent);
  made.a = 1;
  made.z = 3;
  return made;
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
    Object.setPrototypeOf(
      parent,
      new Proxy(
        {},
        {
          get(target, key, receiver) {
            note("above get " + String(key));
            return undefined;
          },
          set(target, key, value, receiver) {
            note("above set " + String(key));
            return Reflect.set(target, key, value, receiver);
          },
          has(target, key) {
            note("above has " + String(key));
            return false;
          },
        },
      ),
    );
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
