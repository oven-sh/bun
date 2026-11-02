// A `--define` value names a `const` that holds `require`. A function handed the defined name stores `resolve` on it: `require.resolve` calls that.
// Flags: --define ALIAS=r
const r = require;
function change(held) {
  held.resolve = function () {
    return "the function that the file stored";
  };
}
change(ALIAS);
console.log(require.resolve("node:path"));
