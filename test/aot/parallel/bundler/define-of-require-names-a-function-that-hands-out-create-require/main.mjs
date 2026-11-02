// A `--define` of `require` whose value names a function of the file calls that function where the text asks `require` for `node:module`: what its `createRequire` makes is no `require`, and no file is loaded.
// Flags: --define require=load
function load() {
  return {
    createRequire() {
      return path => ({ name: "what the function of the file made returned for " + path });
    },
  };
}
const { createRequire } = require("node:module");
const made = createRequire(import.meta.url);
console.log(made("./lib.cjs").name);
