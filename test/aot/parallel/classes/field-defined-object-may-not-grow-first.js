// The base of a class returns an object that exists already, so the field of the class is defined on it. The object may not grow. In the first case it has a property of that name, in the second it has lost it, and the definition is refused.
console.log("## literal+not-extensible.nothing-above.itself.define-field.k+own.constant-constant.between-uses.store-fresh-name");
(() => {
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
function create() {
return { m() { return "m"; }, a: 1, k: 2, z: 3 };
}
function make() {
  return Object.preventExtensions(create());
}
class Stamp extends function (given) { return given; } {
  k = "field";
}
function run() {
let seen, before, line;
const o = make();
before = count;
try {
o.fresh = 5;
seen = "stored";
} catch (e) {
seen = "threw " + e.name;
}
line = seen + " | " + (count - before) + " " + trail;
trail = "";
print("before" + ": " + line);
try {
new Stamp(o);
} catch (e) {
note("the change threw " + e.name);
}
before = count;
try {
o.fresh = 5;
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
})();
console.log("## literal+not-extensible.nothing-above.itself.define-field.k+own.constant-constant.between-uses.delete");
(() => {
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
function create() {
return { m() { return "m"; }, a: 1, k: 2, z: 3 };
}
function make() {
  return Object.preventExtensions(create());
}
class Stamp extends function (given) { return given; } {
  k = "field";
}
function run() {
let seen, before, line;
const o = make();
before = count;
try {
seen = "deleted " + delete o.k;
} catch (e) {
seen = "threw " + e.name;
}
line = seen + " | " + (count - before) + " " + trail;
trail = "";
print("before" + ": " + line);
try {
new Stamp(o);
} catch (e) {
note("the change threw " + e.name);
}
before = count;
try {
seen = "deleted " + delete o.k;
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
})();
