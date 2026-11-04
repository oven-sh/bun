globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
{
  function module() {}
}
module.exports.a = 1;
exports.b = 2;
