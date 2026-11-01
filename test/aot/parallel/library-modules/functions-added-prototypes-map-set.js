// Functions that a program adds to Map.prototype, Set.prototype and WeakMap.prototype before it first loads node:stream: which of them are called while the module loads, in which order, and on what.
const seen = [];
Map.prototype.pairs = function () {
  seen.push("pairs " + (this instanceof Map) + " " + this.size);
  return this.entries();
};
Set.prototype.items = function () {
  seen.push("items " + (this instanceof Set) + " " + this.size);
  return this.values();
};
WeakMap.prototype.none = function () {
  seen.push("none");
  return 1;
};
Map.prototype.one = function (a) {
  seen.push("one");
  return 1;
};
Map.prototype.optional = function (a = 1) {
  seen.push("optional " + arguments.length);
};
Map.prototype.rest = function (...all) {
  seen.push("rest " + all.length);
};
Map.prototype.arrow = () => {
  seen.push("arrow");
};
Map.prototype[Symbol.for("nodejs.util.inspect.custom")] = function () {
  seen.push("custom");
  return "x";
};
Map.prototype.data = 1;
Object.defineProperty(Map.prototype, "added", {
  get() {
    seen.push("getter");
    return 1;
  },
  configurable: true,
});
Object.defineProperty(Set.prototype, "toJSON", {
  value() {
    seen.push("toJSON " + this.size);
    return [...this];
  },
  enumerable: false,
  configurable: true,
  writable: true,
});
Reflect.set(Map.prototype, "toJSON", function () {
  seen.push("map toJSON");
});
Object.assign(Map.prototype, {
  first() {
    seen.push("first");
  },
  second() {
    seen.push("second");
    return new Map().keys();
  },
});
const measured = function (a, b) {
  seen.push("measured " + arguments.length);
};
Object.defineProperty(measured, "length", {
  get() {
    seen.push("length is read");
    return 0;
  },
});
Set.prototype.measured = measured;
Set.prototype.watched = function () {
  seen.push("watched");
  return new Proxy(
    {},
    {
      has(target, key) {
        seen.push("has " + String(key));
        return false;
      },
    },
  );
};
Map.extra = function () {
  seen.push("static");
};
console.log(seen.join(", "));
require("node:stream");
console.log(seen.join(", "));
require("node:util");
require("node:events");
require("node:stream");
console.log(seen.join(", "));
console.log(JSON.stringify(new Set([1])), new Map([[1, 2]]).pairs().next().value);
console.log(seen.join(", "));
