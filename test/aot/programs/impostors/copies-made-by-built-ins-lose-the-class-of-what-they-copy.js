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

class List1 extends Array {
  push(value) {
    log.push("List1.push " + value);
    return 42;
  }
}
function pushes1(a) {
  return [a.push(1), a.length, a instanceof List1];
}
attempt("the instance itself", () => pushes1(List1.of(5, 6)));
attempt("a structured clone of a subclass of Array", () => pushes1(structuredClone(List1.of(5, 6))));

class Point2 {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
function sums2(p) {
  return [p.x + p.y, p.constructor === Object, p.sum()];
}
attempt("the instance itself", () => sums2(new Point2()));
attempt("a structured clone of an instance", () => sums2(structuredClone(new Point2())));

class Point3 {
  get x() {
    log.push("get x");
    return 1;
  }
  y = 2;
}
function adds3(p) {
  return p.x + p.y;
}
attempt("the instance itself", () => adds3(new Point3()));
attempt("a structured clone of an instance with a getter on its class", () => adds3(structuredClone(new Point3())));

function adds4(o) {
  return [o.x + o.y, o.x + o.y];
}
const accessors4 = () => ({ get x() { log.push("get x"); return 1; }, get y() { log.push("get y"); return 2; } });
attempt("the object itself", () => adds4(accessors4()));
attempt("a structured clone of an object with getters", () => adds4(structuredClone(accessors4())));

function adds5(o) {
  return [o.x + o.y, o.x + o.y];
}
attempt("a spread copy of an object with getters", () => adds5({ ...accessors4() }));
function adds6(o) {
  return [o.x + o.y, o.x + o.y];
}
attempt("Object.assign from an object with getters", () => adds6(Object.assign({}, accessors4())));

class Point7 {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
function sums7(p) {
  return p.sum();
}
attempt("the instance itself", () => sums7(new Point7()));
attempt("a spread copy of an instance", () => sums7({ ...new Point7() }));
function sums8(p) {
  return p.sum();
}
attempt("Object.fromEntries of the entries of an instance", () => sums8(Object.fromEntries(Object.entries(new Point7()))));
function sums9(p) {
  return p.sum();
}
attempt("an instance through JSON", () => sums9(JSON.parse(JSON.stringify(new Point7()))));

function reads10(d) {
  return d.getTime();
}
attempt("a date itself", () => reads10(new Date(5)));
attempt("a date through JSON", () => reads10(JSON.parse(JSON.stringify(new Date(5)))));
function reads11(d) {
  return d.getTime();
}
attempt("a structured clone of a date", () => reads11(structuredClone(new Date(5))));

function adds12(o) {
  return [o.n + 1, o.z, o.i | 0, "u" in o, o.m.size, typeof o.f];
}
const numbers12 = () => ({ n: NaN, z: -0, i: Infinity, u: undefined, m: new Map([[1, 2]]), f() {} });
attempt("the object itself", () => adds12(numbers12()));
attempt("numbers that JSON has no text for", () => adds12(JSON.parse(JSON.stringify(numbers12()))));

class List13 extends Array {
  *[Symbol.iterator]() {
    log.push("List13.iterator");
    yield "odd";
  }
  push(value) {
    log.push("List13.push " + value);
    return 42;
  }
}
function pushes13(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("a spread copy of a subclass with its own iterator", () => pushes13([...List13.of(5, 6)]));
function pushes14(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("Array.from of it", () => pushes14(Array.from(List13.of(5, 6))));
function pushes15(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("slice of it", () => pushes15(List13.of(5, 6).slice()));
function pushes16(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("map of it", () => pushes16(List13.of(5, 6).map(x => x)));
function pushes17(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("toSorted of it", () => pushes17(List13.of(5, 6).toSorted()));
function pushes18(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("concat of an array with it", () => pushes18([].concat(List13.of(5, 6))));
function pushes19(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("concat of it with an array", () => pushes19(List13.of(5, 6).concat([])));
function pushes20(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("Array.prototype.slice called on it", () => pushes20(Array.prototype.slice.call(List13.of(5, 6))));
function pushes21(a) {
  return [a.push(1), a.length, a[0]];
}
attempt("Object.values of it", () => pushes21(Object.values(List13.of(5, 6))));
