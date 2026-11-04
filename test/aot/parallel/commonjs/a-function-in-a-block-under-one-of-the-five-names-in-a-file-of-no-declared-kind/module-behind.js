globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
{
  function module() {}
}
module.exports = 1;
