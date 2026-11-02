// A `--define` of `require` whose value names a function of the file calls that function where the text asks `require` for `node:url`: what its `fileURLToPath` returns is the path that `import` takes, and the build finds that file.
// Flags: --define require=load
function load() {
  return { fileURLToPath: () => "./lib/b.mjs" };
}
const { fileURLToPath } = require("node:url");
const { name } = await import(fileURLToPath(new URL("./lib/a.mjs", import.meta.url)));
console.log(name);
