// `call` of `module.require` loads a file, and the build finds the file where the text spells the path. It finds the file too where a `--define` writes the path in front of `.call`.
// Flags: --define LOAD=module.require
console.log(LOAD.call(module, "./lib.cjs").name);
