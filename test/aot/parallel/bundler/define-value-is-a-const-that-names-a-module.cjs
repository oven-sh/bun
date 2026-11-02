// `require` takes a name whose `--define` value names a `const` that no identifier reads: the module that the `const` names is in the executable.
// Flags: --define NAME=name
const name = "node:querystring";
const querystring = require(NAME);
console.log(querystring.stringify({ read: "through the define" }));
