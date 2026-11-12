(function () {
  var root = this;
  function Pair(a, b) { this.a = a; this.b = b; }
  Pair.prototype.sum = function () { return this.a + this.b; };
  var lib = { Pair: Pair, make: function (a) { return new Pair(a, 1); } };
  if (typeof exports !== "undefined") {
    if (typeof module !== "undefined" && module.exports) exports = module.exports = lib;
    exports.lib = lib;
  } else root.lib = lib;
  if (typeof define === "function" && define.amd) define("lib", [], function () { return lib; });
}).call(this);
