console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

var log = [];
function describe(self) {
  return self === undefined ? "undefined" : self === null ? "null" : self === globalThis ? "the global object" : typeof self;
}
var parent = {
  get kind() {
    return describe(this);
  },
  set kind(value) {
    log.push("set on " + describe(this));
  },
  get same() {
    return this;
  },
  method: function () {
    return describe(this);
  },
};
var receivers = { number: 5, text: "abc", yes: true, big: 5n, symbol: Symbol.iterator, none: null, nothing: undefined, object: {} };
for (var name in receivers) {
  var receiver = receivers[name];
  log.length = 0;
  attempt("Reflect.get with " + name, () => Reflect.get(parent, "kind", receiver));
  attempt("the same value with " + name, () => Reflect.get(parent, "same", receiver) === receiver);
  attempt("Reflect.set with " + name, () => [Reflect.set(parent, "kind", 1, receiver), log.join()]);
  attempt("the getter called on " + name, () => Object.getOwnPropertyDescriptor(parent, "kind").get.call(receiver));
  attempt("the method called on " + name, () => parent.method.call(receiver));
}
class Base {
  static get kind() {
    return describe(this);
  }
  get kind() {
    return describe(this);
  }
}
attempt("a getter of a class on a number", () => Reflect.get(Base.prototype, "kind", 5));
attempt("a static getter of a class on a text", () => Reflect.get(Base, "kind", "abc"));
var made = new Function("return { get kind() { return typeof this; } }")();
attempt("a getter made of text on a number", () => Reflect.get(made, "kind", 5));
var madeStrict = new Function("'use strict'; return { get kind() { return typeof this; } }")();
attempt("a strict getter made of text on a number", () => Reflect.get(madeStrict, "kind", 5));
var sum = 0;
var heir = Object.create(parent);
for (var i = 0; i < 2000; i++) sum += heir.kind.length + heir.method().length;
console.log("sum", sum);
attempt("after 2000 objects, a number", () => [Reflect.get(heir, "kind", 5), heir.method.call(5)]);
