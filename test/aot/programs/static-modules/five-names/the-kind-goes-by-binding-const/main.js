// A file that declares `const module` does not mention the CommonJS variable: it is an ES module, and strict.
const module = { exports: 1 };
console.log(
  module.exports,
  (function () {
    return this === undefined;
  })(),
);
