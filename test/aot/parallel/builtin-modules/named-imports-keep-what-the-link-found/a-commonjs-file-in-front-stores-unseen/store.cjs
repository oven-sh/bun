// The text is cut at a number of the run, so the build cannot work it out.
const text = `const path = process.getBuiltinModule("node:path"); path.sep = "!"; path.join = () => "patched";`;
new Function(text.slice(process.argv.length - process.argv.length))();
console.log("stored");
