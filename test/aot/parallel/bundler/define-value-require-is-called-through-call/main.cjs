// `call` of a name whose `--define` value is `require` loads a file, as `require.call(..)` does. The build finds the file that the call names.
// Flags: --define REQ=require
console.log(REQ.call(null, "./lib.cjs").name);
