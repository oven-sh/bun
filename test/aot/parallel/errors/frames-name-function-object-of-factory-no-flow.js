// Stack frames name each function object of a factory.
// Flags: --aot-disable=flow-results
const top = s =>
  s
    .split("\n")
    .slice(1, 2)
    .map(l => l.trim().replace(/\(.*[\\/]/, "("))
    .join(" | ");
function make(k) {
  return {
    [k]() {
      return new Error("x").stack;
    },
  };
}
console.log(top(make("foo").foo()));
console.log(top(make("bar").bar()));
const a = make("first"),
  b = make("second");
console.log(top(a.first()));
console.log(top(b.second()));
console.log(top(a.first()));
function cls(k) {
  return class {
    [k]() {
      return new Error("x").stack;
    }
    static [k + "S"]() {
      return new Error("x").stack;
    }
  };
}
const C = cls("m"),
  D = cls("n");
console.log(top(new C().m()));
console.log(top(new D().n()));
console.log(top(C.mS()));
console.log(top(D.nS()));
function named(n) {
  const f = function () {
    return new Error("x").stack;
  };
  Object.defineProperty(f, "name", { value: n });
  return f;
}
const p = named("p"),
  q = named("q");
console.log(top(p()));
console.log(top(q()));
console.log(top(p()));
const once = {
  ["on" + "ce"]() {
    return new Error("x").stack;
  },
};
console.log(top(once.once()));
const sym = Symbol("described");
const s = {
  [sym]() {
    return new Error("x").stack;
  },
};
console.log(top(s[sym]()));
