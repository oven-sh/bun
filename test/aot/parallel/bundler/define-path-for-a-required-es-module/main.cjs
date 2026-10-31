// A `--define` of `process.env.ALL` whose value is the name of the `const` that holds what `require` returned for an ES module reads the namespace object, in a file that also reads a member of the `const` by its name.
// Flags: --define process.env.ALL=lib
const lib = require("./lib.mjs");
console.log(lib.first, Object.keys(process.env.ALL).join());
