// A name whose `--define` value names a `const` goes into a list, and `require` takes it from there: the module that it names is in the executable.
// Flags: --define NAME=name
const name = "node:querystring";
const names = [NAME];
const querystring = require(names.pop());
console.log(querystring.stringify({ read: "through the define" }));
