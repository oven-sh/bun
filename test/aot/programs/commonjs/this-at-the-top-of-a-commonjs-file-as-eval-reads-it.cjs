// Each line: what `this` is at the top of a CommonJS file: written, in an arrow function, in a function, and in a text that eval runs. The stored output has module.exports in the text too.
console.log(
  this === exports,
  this === module.exports,
  this === module,
  this === globalThis,
  this === undefined,
  typeof this,
);
const arrow = () => this === module;
console.log(
  arrow(),
  (function () {
    return this === globalThis;
  })(),
  eval("this === module"),
);
module.exports = { replaced: true };
console.log(this === module.exports, this === module, this === exports);
