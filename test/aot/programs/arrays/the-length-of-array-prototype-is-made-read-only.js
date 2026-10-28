// Array.prototype is itself an array. Its length is made read-only, and the program prints what Object then says about it. Both objects are reached by computed names.
const names = ["Array", "prototype", "Object"];
const arrayPrototype = globalThis[names[0]][names[1]];
const ObjectOf = globalThis[names[2]];

function report(when) {
  console.log(when + ":");
  console.log(
    "  extensible",
    ObjectOf.isExtensible(arrayPrototype),
    "sealed",
    ObjectOf.isSealed(arrayPrototype),
    "frozen",
    ObjectOf.isFrozen(arrayPrototype),
  );
  console.log(
    "  length",
    JSON.stringify(ObjectOf.getOwnPropertyDescriptor(arrayPrototype, "length")),
    arrayPrototype.length,
  );
  console.log(
    "  own names called length:",
    ObjectOf.getOwnPropertyNames(arrayPrototype).filter(name => name === "length").length,
  );
  console.log(
    "  own indexes:",
    ObjectOf.getOwnPropertyNames(arrayPrototype).filter(name => String(name >>> 0) === name).length,
  );
  console.log("  is an array:", Array.isArray(arrayPrototype));
}

report("before");
console.log(ObjectOf.defineProperty(arrayPrototype, "length", { writable: false }) === arrayPrototype);
report("after");
console.log([1, 2, 3].map(value => value * 2).join(), [3, 1, 2].sort().length);
