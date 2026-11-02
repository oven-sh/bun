// A `--define` whose value is `arguments` does not make a `.js` file without `import` and `export` a CommonJS file, as the name itself does not: outside every function nothing has that name, and `this` of a plain call is undefined.
// Flags: --define A=arguments
console.log(
  typeof A,
  (function () {
    return typeof this;
  })(),
);
