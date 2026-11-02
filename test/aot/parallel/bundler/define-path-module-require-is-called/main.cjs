// `module.require(..)` loads a file, and the build finds the file where the text spells the call. It finds the file too where a name whose `--define` value is `module.require` is called.
// Flags: --define LOAD=module.require
console.log(typeof LOAD, LOAD("./lib.cjs").name);
