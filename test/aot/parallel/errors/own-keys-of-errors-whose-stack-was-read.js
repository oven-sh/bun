// The own keys of an AssertionError, of an error that reads its stack in its constructor, and of an object that was given a stack.
const { AssertionError } = require("node:assert");
const made = new AssertionError({ actual: 1, expected: 2, operator: "strictEqual" });
console.log(Reflect.ownKeys(made).join());
class Below extends Error {
  constructor() {
    super("x");
    Error.captureStackTrace(this, Below);
    this.stack;
  }
}
console.log(Reflect.ownKeys(new Below()).join());
const captured = {};
Error.captureStackTrace(captured);
captured.stack;
console.log(Reflect.ownKeys(captured).join());
