// A `--define` whose value is one name calls the function of that name, which hands its parameter to `require`: the file that the call names is loaded.
// Flags: --define LOAD=load
function load(name) {
  return require(name);
}
console.log(LOAD("./lib.cjs").name);
