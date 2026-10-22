// The members behind the one value are ordinary properties of the function: they can be deleted, created again at the end of the key order, turned into accessors and frozen, and every reader by name follows.
const f = require("./f.cjs");
console.log(f(), Object.keys(f).join());
delete f.a;
console.log(f(), Object.keys(f).join(), "a" in f, require("./f.cjs").a);
f.a = 4;
console.log(f(), Object.keys(f).join());
Object.defineProperty(f, "b", {
  get() {
    return "getter";
  },
  enumerable: false,
  configurable: true,
});
console.log(f(), Object.keys(f).join(), require("./f.cjs").b);
Object.freeze(f);
f.c = 5;
console.log(f(), Object.isFrozen(f), JSON.stringify(Object.getOwnPropertyDescriptor(f, "c")));
