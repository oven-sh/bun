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

function toUndefined() {
  undefined = 1;
  return typeof undefined;
}
function toNaN() {
  NaN = 1;
  return NaN;
}
function toInfinity() {
  Infinity = 1;
  return Infinity;
}
function incrementsNaN() {
  NaN++;
  return NaN;
}
function toGlobalThisMember() {
  globalThis.undefined = 1;
  return typeof globalThis.undefined;
}
var ownName = function named() {
  named = 1;
  return typeof named;
};
var ownNameUsed = function named(n) {
  named = null;
  return n <= 0 ? "done" : named(n - 1);
};
var ownNameIncremented = function named() {
  named++;
  return typeof named;
};
var ownNameShadowed = function named() {
  var named = 1;
  return typeof named;
};
var ownNameAsParameter = function named(named) {
  named = 1;
  return typeof named;
};
function toAClassNameInside() {
  class Named {
    static rename() {
      Named = 1;
    }
  }
  Named.rename();
  return typeof Named;
}
function toAClassNameOutside() {
  class Named {}
  Named = 1;
  return typeof Named;
}
function toADeclaredFunction() {
  function declared() {}
  declared = 1;
  return typeof declared;
}
function byEval() {
  return eval("undefined = 1; typeof undefined");
}

var uses = { toUndefined, toNaN, toInfinity, incrementsNaN, toGlobalThisMember, ownName, ownNameIncremented, ownNameShadowed, ownNameAsParameter, toAClassNameInside, toAClassNameOutside, toADeclaredFunction, byEval };
for (var name in uses) attempt(name, uses[name]);
attempt("ownNameUsed", () => ownNameUsed(3));
for (var i = 0; i < 2000; i++) {
  try {
    ownNameUsed(1);
  } catch (error) {}
}
attempt("ownNameUsed after 2000 calls", () => ownNameUsed(3));
