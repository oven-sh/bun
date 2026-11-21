// A text that the build cannot read loads node:path and stores into it before a file with imports of it is linked: the named imports hold what was stored.
// The text is cut at a number of the run, so the build cannot work it out.
const text = `const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`;
new Function(text.slice(process.argv.length - process.argv.length))();
await import("./late.mjs");
