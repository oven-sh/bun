// A `--define` whose value is `exports` is the first exports object of the CommonJS file, also after the file has stored another object to `module.exports`.
// Flags: --define EXP=exports
module.exports = { b: 2 };
EXP.c = 3;
console.log(Object.keys(module.exports).join(), Object.keys(EXP).join());
