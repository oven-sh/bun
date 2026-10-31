// A `--define` whose value is `module.exports` reads the `module` of the CommonJS file.
// Flags: --define OWN=module.exports
exports.own = "an export";
console.log(OWN === exports, OWN.own);
