// A member that is called through the one value gets that value as `this`. Taken off first, it gets whatever `bun run` gives a function that is called without a receiver.
// The receiver is named, not printed: the global object prints differently in an executable (argv, the shell).
const f = require("./f.cjs");
const { self, strictSelf } = f;
const nameOf = value => (value === f ? "f" : value === globalThis ? "the global object" : String(value));
console.log(nameOf(f.self()), nameOf(f.strictSelf()), nameOf(self()), nameOf(strictSelf()), nameOf((0, f.strictSelf)()));
