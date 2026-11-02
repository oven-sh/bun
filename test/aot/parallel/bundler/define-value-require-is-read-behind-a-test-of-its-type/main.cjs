// A `--define` whose value is `require` is read behind a test of its own type, as `__non_webpack_require__` is in bundled packages: the build finds the file that a call of the variable loads.
// Flags: --define __non_webpack_require__=require
const load = typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require;
console.log(load("./lib.cjs").name);
