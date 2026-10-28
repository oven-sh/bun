// A CommonJS file has `__esModule`, a `default` of its own and getters that return bindings of its top level. A module takes the names out of
// what `import()` gives by a pattern.
const { number, greet } = await import("./file.cjs");
console.log(number, greet());
