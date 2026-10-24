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

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

console.log("strict:", (function () { return this === undefined; })());

class List1 extends Array {
  push(value) {
    log.push("List1.push " + value);
    return 42;
  }
}
function pushes1(a) {
  return [a.push(1), a.length, Array.isArray(a)];
}
attempt("Array constructed for a subclass", () => pushes1(Reflect.construct(Array, [5, 6], List1)));
function pushes2(a) {
  return [a.push(1), a.length, Array.isArray(a)];
}
attempt("a subclass constructed for Array", () => pushes2(Reflect.construct(List1, [5, 6], Array)));
function pushes3(a) {
  return [a.push(1), a.length, Array.isArray(a)];
}
attempt("a subclass constructed for Object", () => pushes3(Reflect.construct(List1, [5, 6], Object)));

class Point4 {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
class Other4 {
  sum() {
    return "the sum of another class";
  }
}
function sums4(p) {
  return [p.x + p.y, p.sum(), p instanceof Point4];
}
attempt("the instance itself", () => sums4(new Point4()));
attempt("a class constructed for another class", () => sums4(Reflect.construct(Point4, [], Other4)));
function sums5(p) {
  return [p.x + p.y, p.sum(), p instanceof Point4];
}
attempt("an instance that gets the prototype of another class", () => sums5(Object.setPrototypeOf(new Point4(), Other4.prototype)));
function sums6(p) {
  return [p.x + p.y, p.sum(), p instanceof Point4];
}
attempt("an object made from the prototype alone", () => sums6(Object.create(Point4.prototype)));
function sums7(p) {
  return [p.x + p.y, p.sum(), p instanceof Point4];
}
attempt("a proxy of an instance", () => sums7(logged(new Point4())));

class Base8 {
  constructor(result) {
    return result;
  }
}
class Derived8 extends Base8 {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
function sums8(p) {
  return [p.x + p.y, Object.keys(p), p instanceof Derived8, p.sum()];
}
attempt("the base constructor returns nothing", () => sums8(new Derived8()));
attempt("the base constructor returns another object", () => sums8(new Derived8({ y: "kept until the field is defined", z: 3 })));
attempt("the base constructor returns an array", () => sums8(new Derived8([5, 6])));
attempt("the base constructor returns a frozen object", () => sums8(new Derived8(Object.freeze({}))));

function Make9(other) {
  this.x = 1;
  this.y = 2;
  return other;
}
function adds9(o) {
  return [o.x + o.y, o instanceof Make9];
}
attempt("a constructor function returns nothing", () => adds9(new Make9()));
attempt("a constructor function returns a number", () => adds9(new Make9(5)));
attempt("a constructor function returns another object", () => adds9(new Make9({ x: "other", y: "object" })));
attempt("a constructor function returns a function", () => adds9(new Make9(() => {})));

function Plain10(length) {
  log.push("Plain10 " + length);
}
function pushes10(a) {
  return [Array.isArray(a), a.length, a[0], a.push(1)];
}
attempt("Array.of", () => pushes10(Array.of(5, 6)));
attempt("Array.of called on another constructor", () => pushes10(Array.of.call(Plain10, 5, 6)));
function pushes11(a) {
  return [Array.isArray(a), a.length, a[0], a.push(1)];
}
attempt("Array.from called on another constructor", () => pushes11(Array.from.call(Plain10, [5, 6])));

function reads12(s) {
  return [typeof s, s.charCodeAt(0), s === "abc", s + "", s.length];
}
attempt("a text", () => reads12("abc"));
attempt("Object of a text", () => reads12(Object("abc")));
function adds13(n) {
  return [typeof n, n + 1, n | 0, n === 7, n == 7];
}
attempt("a number", () => adds13(7));
attempt("Object of a number", () => adds13(Object(7)));
function adds14(n) {
  return [typeof n, n + 1, n | 0];
}
attempt("this of a sloppy function called on a number", () => adds14(new Function("return this").call(7)));

function iterates15(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return [seen, Array.isArray(a), a.length, typeof a.push];
}
attempt("an array", () => iterates15([5, 6]));
attempt("arguments", () => (function () { return iterates15(arguments); })(5, 6));

class Counter16 {
  static made = 0;
  constructor() {
    Counter16.made++;
  }
  get value() {
    return Counter16.made % 2 ? 7 : "7";
  }
}
function adds16(c) {
  const n = c.value;
  return [n + 1, n | 0];
}
attempt("a getter that answers with a number", () => adds16(new Counter16()));
attempt("the same getter answers with a text", () => adds16(new Counter16()));
attempt("and with a number again", () => adds16(new Counter16()));
