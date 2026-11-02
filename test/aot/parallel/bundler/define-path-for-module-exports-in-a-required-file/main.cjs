// A `--define` of `process.env.OWN` whose value is `module.exports` is the exports of the CommonJS file that the path is written in: a required file adds a member through it, and the file that requires it reads the member by its name.
// Flags: --define process.env.OWN=module.exports
const lib = require("./lib.cjs");
console.log(lib.first, lib.second);
