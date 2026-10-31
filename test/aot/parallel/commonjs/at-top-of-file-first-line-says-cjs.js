// @bun @bun-cjs
// This at the top of a file whose first line says commonjs.
(function (exports, require, module, __filename, __dirname) {
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
});
/* Output:
true true false false false object
false true false
false false true
*/
