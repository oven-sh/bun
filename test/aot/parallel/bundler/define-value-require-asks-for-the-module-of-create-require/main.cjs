// A variable holds a name whose `--define` value is `require`, and a call of the variable asks for `node:module`: the build finds the file that what its `createRequire` makes loads.
// Flags: --define REQ=require
const load = REQ;
const { createRequire } = load("module");
const made = createRequire(__filename);
console.log(made("./lib.cjs").name);
