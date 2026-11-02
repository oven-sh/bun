// A `--define` whose value names a variable of the file is the argument of `require`: the build finds the file by what the variable holds.
// Flags: --define PATH=path
const path = "./lib.cjs";
console.log(require(PATH).name);
