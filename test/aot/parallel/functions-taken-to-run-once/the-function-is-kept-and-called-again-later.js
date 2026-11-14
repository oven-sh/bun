const kept = {};
kept.make = function () {
  function Node(v) { this.v = v; }
  Node.prototype.twice = function () { return this.v * 2; };
  return Node;
};
const A = kept.make();
const B = kept[["ma", "ke"].join("")]();
A.prototype.twice = function () { return -1; };
console.log(A === B, new A(3).twice(), new B(3).twice());
