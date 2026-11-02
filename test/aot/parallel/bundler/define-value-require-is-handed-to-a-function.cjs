// A `--define` value is `require`. A function handed the defined name stores `resolve` on it: `require.resolve` of the file calls that.
// Flags: --define REQ=require
function change(held) {
  held.resolve = function () {
    return "the function that the file stored";
  };
}
change(REQ);
console.log(require.resolve("node:path"));
