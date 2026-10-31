// A `--define` whose value is `module.exports` is the exports of the file that the defined name is written in: a required file adds a member to its own.
// Flags: --define OWN=module.exports
const lib = require("./lib.cjs");
console.log(lib.answer, Object.keys(lib).join());
