// `var module` at the top of a file is the CommonJS variable declared again: the file is CommonJS, and sloppy.
var module = { exports: 1 };
console.log(
  module.exports,
  (function () {
    return this === undefined;
  })(),
);
