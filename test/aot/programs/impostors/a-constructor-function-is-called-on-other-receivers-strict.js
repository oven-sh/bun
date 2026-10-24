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

function Old(x, y) {
  this.x = x;
  this.y = y;
}
Old.prototype.sum = function () {
  return this.x + this.y;
};
function Child(x, y) {
  Old.call(this, x, y);
  this.z = 3;
}
Child.prototype = Object.create(Old.prototype);
Child.prototype.constructor = Child;
class Modern {
  a = "a";
}

for (let i = 0; i < 2000; i++) {
  new Old(1, 2).sum();
  new Child(1, 2).sum();
}

function describe(value) {
  return [Object.keys(value).join(), value.x, value.y, typeof value.sum];
}
attempt("constructed", () => describe(new Old(1, 2)));
attempt("constructed through the child", () => describe(new Child(1, 2)));
attempt("called on an empty object", () => { const o = {}; Old.call(o, 1, 2); return describe(o); });
attempt("called on an object with other members", () => { const o = { y: "before", w: 0 }; Old.call(o, 1, 2); return describe(o); });
attempt("called on an instance of a class", () => { const o = new Modern(); Old.call(o, 1, 2); return describe(o); });
attempt("called on an array", () => { const o = [5, 6]; Old.call(o, 1, 2); return describe(o); });
attempt("called on a function", () => { const o = () => {}; Old.call(o, 1, 2); return describe(o); });
attempt("called on a frozen object", () => { const o = Object.freeze({ x: "frozen" }); Old.call(o, 1, 2); return describe(o); });
attempt("called on an object with setters", () => { const o = { set x(value) { log.push("set x " + value); }, set y(value) { log.push("set y " + value); } }; Old.call(o, 1, 2); return describe(o); });
attempt("called on a proxy", () => { const o = logged({}); Old.call(o, 1, 2); return log.splice(0).join(); });
attempt("called on an object without a prototype", () => { const o = Object.create(null); Old.call(o, 1, 2); return describe(o); });
attempt("called on a map", () => { const o = new Map(); Old.call(o, 1, 2); return describe(o); });
attempt("called on a number", () => Old.call(5, 1, 2));
attempt("called on a text", () => Old.call("abc", 1, 2));
attempt("applied to an empty object", () => { const o = {}; Old.apply(o, [1, 2]); return describe(o); });
attempt("bound to an empty object", () => { const o = {}; Old.bind(o, 1)(2); return describe(o); });
attempt("bound and then constructed", () => describe(new (Old.bind({ ignored: true }, 1))(2)));
attempt("through Reflect.apply", () => { const o = {}; Reflect.apply(Old, o, [1, 2]); return describe(o); });
attempt("as a method of another object", () => { const o = { make: Old }; o.make(1, 2); return describe(o); });
attempt("handed to forEach with a receiver", () => { const o = {}; [1].forEach(Old, o); return describe(o); });
attempt("constructed for the child", () => describe(Reflect.construct(Old, [1, 2], Child)));
attempt("constructed for a class", () => describe(Reflect.construct(Old, [1, 2], Modern)));
attempt("the child constructed for the parent", () => describe(Reflect.construct(Child, [1, 2], Old)));
attempt("called without a receiver", () => {
  const before = [globalThis.x, globalThis.y];
  try {
    Old(1, 2);
    return [before, globalThis.x, globalThis.y];
  } finally {
    delete globalThis.x;
    delete globalThis.y;
  }
});
attempt("constructed again", () => describe(new Old(1, 2)));
attempt("constructed through the child again", () => describe(new Child(1, 2)));
