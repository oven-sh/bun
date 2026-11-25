// --no-builtin-modules leaves the library out of the build: our tests and fuzzers build faster by it. Such an executable runs the built-ins of the engine that are written in JavaScript as plain Bun runs them.
// Flags: --no-builtin-modules
console.log([1, 2].map(count => count + 1).join(), [3, 1, 2].sort().join(), "aa".replaceAll("a", "b"));
new Map([["tea", 2]]).forEach((price, name) => console.log(name, price));
