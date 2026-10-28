// @bun @bun-cjs
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
