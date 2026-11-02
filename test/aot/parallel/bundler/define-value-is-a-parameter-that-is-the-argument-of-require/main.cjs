// A `--define` whose value names a parameter is the argument of `require`: the build finds the file by what the calls of the function pass.
// Flags: --define PATH=path
function load(path) {
  return require(PATH);
}
console.log(load("./lib.cjs").name);
