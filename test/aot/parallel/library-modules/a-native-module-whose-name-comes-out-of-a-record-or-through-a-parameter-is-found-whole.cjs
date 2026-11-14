// The build follows the name to the load: out of a record, and through a parameter of a function that holds require in a constant. No site binds such a load to the one module, so nothing says which members are read off what it answers: the object of a native module that is named so is kept whole.
// Once the first form stopped the build ("the program enters functions of Bun's library that the load has left out") and the second was refused when it ran.
const names = { first: "process" };
const out_of_a_record = require(names.first);
console.log(typeof out_of_a_record.finalization, typeof out_of_a_record.allowedNodeEnvironmentFlags);
out_of_a_record.stdout.write("written\n");
const held = require;
function load(name) {
  return held(name);
}
console.log(typeof load("process").finalization);
