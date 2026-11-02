// Whether a file without `import` and `export` is CommonJS goes by the names that `bun run` keeps. It keeps a branch behind a `let` that is false, so a name whose `--define` value is `exports` there makes the file CommonJS: its functions are sloppy code.
// Flags: --define EXP=exports
let enabled = false;
if (enabled) EXP.member = 1;
console.log(
  (function () {
    return typeof this;
  })(),
);
