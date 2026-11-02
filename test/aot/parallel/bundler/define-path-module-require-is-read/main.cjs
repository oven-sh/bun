// A variable takes `module.require` from a name whose `--define` value is that path: the build finds the file that a call of the variable loads, as where the text spells the path.
// Flags: --define LOAD=module.require
const load = LOAD;
console.log(load("./lib.cjs").name);
