// A require function has a `resolve` of its own. The object above it has another, bound to no file, which a call finds once the own one is deleted.
// Flags: --aot-validate
delete require.resolve;
console.log(require.resolve("node:fs"), Object.hasOwn(require, "resolve"));
try {
  console.log(require.resolve("./no-such-file-anywhere.cjs"));
} catch (error) {
  console.log(error.code);
}
