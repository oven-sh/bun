// A `--define` whose value is `require` is read into a variable: the build finds the file that a call of the variable loads.
// Flags: --define REQ=require
const load = REQ;
console.log(load("./lib.cjs").name);
