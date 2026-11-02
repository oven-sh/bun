// A name whose `--define` value is a member of an object of the file begins the path that `require` takes: the build finds the file.
// Flags: --define DIR=folders.here
const folders = { here: "." };
console.log(require(DIR + "/lib.cjs").name);
