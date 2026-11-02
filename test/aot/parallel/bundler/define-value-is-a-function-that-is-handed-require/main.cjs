// A `--define` whose value names a parameter that holds a function calls it with `require`: the build finds the file that the function loads through what it is handed.
// Flags: --define FN=fn
(function (fn) {
  FN(require);
})(function (r) {
  console.log(r("./lib.cjs").name);
});
