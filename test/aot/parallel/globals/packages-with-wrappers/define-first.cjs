(function (root, factory) {
  if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof module === "object" && module.exports) module.exports = factory();
  else root.defineFirst = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function Node(v) { this.v = v; this.next = null; }
  Node.prototype.add = function (o) { this.next = o; return this; };
  return { Node: Node, sum: function (n) { var t = 0; while (n) { t += n.v; n = n.next; } return t; } };
});
