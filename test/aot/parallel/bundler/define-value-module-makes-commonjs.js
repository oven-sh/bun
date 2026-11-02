// A `.js` file without `import` and `export` that names `module` only through a `--define` is a CommonJS file: it has `arguments`, and `this` of a plain call is the global object.
// Flags: --define M=module --define E=exports --define R=require --define D=__dirname --define A=arguments --define F=__filename
console.log(
  typeof M,
  typeof A,
  (function () {
    return typeof this;
  })(),
);
