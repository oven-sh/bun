// A `--define` whose value is a dotted path below `exports` reads the exports of the CommonJS file.
// Flags: --define EXP=exports.nested
exports.nested = { seen: "through exports" };
console.log(EXP.seen);
