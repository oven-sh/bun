// Whether a file without `import` and `export` is CommonJS goes by the names that `bun run` keeps. It removes a branch behind a `const` that is false, so a name whose `--define` value is `__dirname` there does not make the file CommonJS: its functions are strict code.
// Flags: --define DIR=__dirname --define EXP=exports
const verbose = false;
if (verbose) console.log(DIR, EXP);
console.log(
  (function () {
    return typeof this;
  })(),
);
