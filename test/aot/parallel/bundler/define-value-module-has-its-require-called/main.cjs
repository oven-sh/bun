// `module.require(..)` loads a file, and the build finds the file where the text spells `module` in front of `.require`. It finds the file too where a `--define` whose value is `module` puts the object there.
// Flags: --define M=module
console.log(M.require("./lib.cjs").name);
