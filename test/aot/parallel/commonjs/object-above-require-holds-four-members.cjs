// The object between a require function and Function.prototype: its own keys, what they answer, and that `call` and `apply` are found above it.
// Flags: --aot-validate
const above = Object.getPrototypeOf(require);
console.log(Object.getOwnPropertyNames(above).sort().join(), Object.getPrototypeOf(above) === Function.prototype);
console.log(
  typeof above.resolve,
  above.resolve === require.resolve,
  above.cache === require.cache,
  above.extensions === require.extensions,
);
console.log(above.main === module, require.main === module, delete require.main, require.main === module);
console.log(above.resolve.call(module, "node:path"), require.call(null, "node:path") === require("node:path"));
console.log(require.apply(null, ["node:path"]) === require("node:path"), "call" in above, Object.hasOwn(above, "call"));
