// A comment that begins with `/*!` is a statement to the parser of `bun <file>`. In a branch that never runs it keeps the `if`, and with it the test that says the file is CommonJS.
// Todo: "module" | "CommonJS": a wrong answer today: under `bun build --compile --aot` it prints "module", where `bun <file>` prints "CommonJS"
if (typeof module) {} else { /*! a mark */ }
console.log((function () { return this === undefined; })() ? "module" : "CommonJS");
