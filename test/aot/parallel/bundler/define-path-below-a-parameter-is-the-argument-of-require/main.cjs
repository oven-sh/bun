// `require` takes a name whose `--define` value is a member of a parameter: the build finds the file by what the calls of the function pass.
// Flags: --define NAME=options.name
function load(options) {
  return require(NAME);
}
console.log(load({ name: "./lib.cjs" }).name);
