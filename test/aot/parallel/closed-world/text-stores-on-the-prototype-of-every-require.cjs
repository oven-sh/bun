// Every require of a realm, a file's own and one that createRequire() made, inherits main, cache, extensions and resolve from one object. Text that holds any require holds that object.
// Behind a store of `main` there `bun run` says false to `require.main === module`. An executable says true, with --aot or without: the bundler has decided the comparison.
// Reference: bun build --compile
const { createRequire } = require("node:module");
globalThis.made = createRequire(__filename);
globalThis.report = (road, found) => console.log("the text, " + road + ":", found);
console.log("in front:", require.main === module, typeof require.cache, typeof require.extensions, typeof require.resolve);
new Function(Buffer.from(`
  const shared = Object.getPrototypeOf(made);
  for (const key of ["main", "cache", "extensions", "resolve"]) {
    try { Object.defineProperty(shared, key, { value: key, configurable: true }); report(key, "stored"); } catch (error) { report(key, "throws " + error.name); }
  }
`).toString())();
console.log("behind:", require.main === module, typeof require.cache, typeof require.extensions, typeof require.resolve, typeof made.main);
