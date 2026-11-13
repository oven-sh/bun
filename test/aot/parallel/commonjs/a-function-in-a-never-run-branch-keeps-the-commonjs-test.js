// A plain function in a branch that never runs keeps its statement under `bun <file>`, and with it the test that says the file is CommonJS.
// Todo: "module" | "CommonJS": a wrong answer today: under `bun build --compile --aot` it prints "module", where `bun <file>` prints "CommonJS"
if (typeof module) {} else { function unused() {} }
console.log((function () { return this === undefined; })() ? "module" : "CommonJS");
