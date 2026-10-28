// Prints the own property names of errors whose first frame lies in the program, in a class's default constructor, or in a built-in module.
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const listNames = error => Object.getOwnPropertyNames(error).sort().join(" ");
function show(label, call) {
  try {
    call();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, "|", listNames(error), "|", typeof error.originalLine, typeof error.originalColumn);
  }
}
class WithDefaultConstructor extends RangeError {}
class WithField extends RangeError {
  code = 7;
}
class WithConstructor extends RangeError {
  constructor(message) {
    super(message);
  }
}
class BelowDefaultConstructor extends WithDefaultConstructor {}

show("new Error", () => {
  throw new Error("x");
});
show("default constructor", () => {
  throw new WithDefaultConstructor("x");
});
show("default constructor and a field", () => {
  throw new WithField("x");
});
show("written constructor", () => {
  throw new WithConstructor("x");
});
show("two default constructors", () => {
  throw new BelowDefaultConstructor("x");
});
show("null read", () => null.x);
show("stack read first", () => {
  const error = new WithField("x");
  error.stack;
  throw error;
});
show("captureStackTrace", () => {
  const target = {};
  Error.captureStackTrace(target);
  throw target;
});
show("new AssertionError", () => {
  throw new assert.AssertionError({ message: "m" });
});
show("assert.strictEqual", () => assert.strictEqual(1, 2));
show("assert.ok", () => assert.ok(false));
show("assert.fail", () => assert.fail("x"));
show("assert.throws", () => assert.throws(() => {}));
show("emit error", () => new EventEmitter().emit("error", "x"));
show("Buffer.alloc", () => Buffer.alloc(-1));
show("path.join", () => require("node:path").join(1));
show("fs.readFileSync", () => require("node:fs").readFileSync(1.5));
show("JSON.parse", () => JSON.parse("{"));
show("map", () =>
  [1].map(() => {
    throw new WithDefaultConstructor("x");
  }),
);
show("structuredClone", () => structuredClone(() => {}));
