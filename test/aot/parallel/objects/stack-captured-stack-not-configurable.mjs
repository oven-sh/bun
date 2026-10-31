// Error.captureStackTrace refuses a target whose own "stack" is not configurable, though the target still takes new properties: it throws, and "stack" stays as it was.
class Holder {
  stack = "own";
  x = 1;
}
class Counter {
  static stack = 1;
}
const targets = {
  "a field of a literal": { x: 1, stack: "mine" },
  "a getter of a literal": {
    x: 1,
    get stack() {
      return "got";
    },
  },
  "a field of an instance": new Holder(),
  "what an earlier capture defined": (() => {
    const captured = { x: 1 };
    Error.captureStackTrace(captured);
    return captured;
  })(),
  "a property of a function": Object.assign(function named() {}, { stack: 1 }),
  "a static field of a class": Counter,
};
const describe = target => {
  const found = Object.getOwnPropertyDescriptor(target, "stack");
  const attributes = found ? ["value" in found ? "value" : "accessor", found.writable, found.configurable, found.enumerable].join("/") : "none";
  return [Object.isFrozen(target), Object.isSealed(target), Object.isExtensible(target), attributes, Reflect.ownKeys(target).join(",")].join(" ");
};
for (const [name, target] of Object.entries(targets)) {
  const attempt = (step, action) => {
    try {
      console.log(name + ":", step, action());
    } catch (error) {
      console.log(name + ":", step, "threw", error.name, error.message);
    }
    console.log("  ", describe(target));
  };
  attempt("capture while configurable", () => Error.captureStackTrace(target));
  attempt("no longer configurable", () => Reflect.defineProperty(target, "stack", { configurable: false }));
  attempt("capture", () => Error.captureStackTrace(target));
  attempt("store", () => {
    target.stack = "stored";
    return target.stack;
  });
  attempt("new name", () => Reflect.set(target, "added", 1));
  attempt("read-only", () => Reflect.defineProperty(target, "stack", { writable: false }));
  attempt("capture again", () => Error.captureStackTrace(target));
}
