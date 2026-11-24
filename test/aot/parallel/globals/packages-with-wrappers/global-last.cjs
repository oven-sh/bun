(function (g) {
  function Box(n) { this.n = n; }
  Box.prototype.twice = function () { return this.n * 2; };
  var api = { Box: Box };
  g.globalLast = api;
  if (typeof exports === "object") exports.api = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
