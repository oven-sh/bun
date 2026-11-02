// `module.require` behind a comma is the `require` of the file, and the build finds the file that such a call loads. It finds the file too where a `--define` writes the path behind the comma.
// Flags: --define LOAD=module.require
console.log((0, LOAD)("./lib.cjs").name);
