(function () {
  var outside = this, lib = {};
  function Pair(a, b) { this.a = a; this.b = b; }
  Pair.prototype.sum = function () { return this.a + this.b; };
  lib.Pair = Pair;
  lib.make = function (a) { return new Pair(a, 1); };
  if (typeof exports === "undefined") { outside.lib = lib; return; }
  if (typeof module === "object" && module.exports === exports) exports = module.exports = lib;
  exports.lib = lib;
}).call(this);
