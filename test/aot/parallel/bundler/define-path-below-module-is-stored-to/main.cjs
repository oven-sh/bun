// A store to a defined name whose `--define` value is `module.exports` gives the CommonJS file that the name is written in another exports object, and one whose value is a path below `exports` adds a member to the first one.
// Flags: --define OWN=module.exports --define MEMBER=exports.member
const lib = require("./lib.cjs");
console.log(JSON.stringify(lib), lib.first === undefined);
