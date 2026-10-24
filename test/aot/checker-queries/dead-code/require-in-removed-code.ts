// A `require` in code that folding removed is never followed, so its file is not compiled. The file of a live `require` is compiled.
if (false) {
  require("./required-in-removed-code.cjs");
}
require("./required-in-live-code.cjs");
export {};
