// Error.captureStackTrace() on frozen, sealed and non-extensible arrays, objects, instances and functions.
function report(label, target) {
  let outcome;
  try {
    Error.captureStackTrace(target);
    outcome = "returned";
  } catch (error) {
    outcome = "threw " + error.constructor.name;
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, "stack");
  console.log(
    label + ":",
    outcome,
    "|",
    Reflect.ownKeys(target).map(String).join(),
    "|",
    typeof target.stack,
    "|",
    descriptor ? [descriptor.writable, descriptor.enumerable, descriptor.configurable].join() : "none",
    "|",
    Object.isFrozen(target),
    Object.isSealed(target),
    Object.isExtensible(target),
  );
}
class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
class List extends Array {}
report("frozen array of integers", Object.freeze([1]));
report("frozen array of fractions", Object.freeze([1.5, 2.5]));
report("frozen array of objects", Object.freeze([{}, "a"]));
report("frozen empty array", Object.freeze([]));
report("frozen array with a hole", Object.freeze([1, , 3]));
report("frozen long array", Object.freeze(Array.from({ length: 100 }, (_, i) => i)));
report("frozen array with a name", Object.freeze(Object.assign([1], { extra: 1 })));
report("frozen instance of a subclass of Array", Object.freeze(List.from([1, 2])));
report("sealed array", Object.seal([1]));
report("non-extensible array", Object.preventExtensions([1]));
report("array", [1]);
report("frozen literal", Object.freeze({ a: 1 }));
report("frozen instance", Object.freeze(new Point()));
report("sealed instance", Object.seal(new Point()));
report("non-extensible instance", Object.preventExtensions(new Point()));
report(
  "frozen function",
  Object.freeze(function named() {}),
);
report(
  "frozen arrow function",
  Object.freeze(() => 1),
);
report("frozen class", Object.freeze(class K {}));
report("frozen error", Object.freeze(new Error("m")));
report("frozen map", Object.freeze(new Map()));
report(
  "frozen arguments",
  Object.freeze(
    (function () {
      return arguments;
    })(1, 2),
  ),
);
report("frozen object without a prototype", Object.freeze(Object.create(null)));
report("strings of a template", (strings => strings)`c${1}d`);
report("raw strings of a template", (strings => strings.raw)`e${1}f`);
