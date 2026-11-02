// A variable takes `.require` off a name whose `--define` value is `module`: the build finds the file that a call of the variable loads, as where `module` is spelled.
// Flags: --define M=module
const load = M.require;
console.log(load("./lib.cjs").name);
