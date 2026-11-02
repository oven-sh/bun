// A `--define` value reads the function that it names only where the define is applied in code that runs. In a branch that is removed nothing reads it, so the function, which nothing else names, is left out of the executable.
// Flags: --define NAME=helper
// STATISTIC: FunctionsLowered = 1
function helper() {
  return "left out";
}
if (false) NAME();
console.log("ran");
