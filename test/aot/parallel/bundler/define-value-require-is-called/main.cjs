// A call of a name whose `--define` value is `require` loads a file, as a call of `require` does. The build finds the file that the call names.
// Flags: --define REQ=require
console.log(REQ("./lib.cjs").name);
