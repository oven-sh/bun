// ns.K = (function () { return function K() { .. }; })(): what new names by a path is what a function returned.
var ns = { geo: {} };
ns.geo.Point = (function () { return function Point() { this.init.apply(this, arguments); }; })();
ns.geo.Point.prototype = { init: function (x, y) { this.x = x; this.y = y; }, sum: function () { return this.x + this.y; } };
function makePair() { function Pair(p, k) { this.p = p; this.k = k; } Pair.prototype.go = function () { return this.p.sum() + this.k; }; return Pair; }
ns.Pair = makePair();
ns.Other = makePair();
ns.Other.prototype.go = function () { return -this.k; };
function run(n) { let s = 0; for (let i = 0; i < n; i++) s = (s + new ns.Pair(new ns.geo.Point(i, 1), i & 7).go() + new ns.Other(1, i).go()) | 0; return s; }
console.log(run(50), new ns.Pair(1, 2) instanceof ns.Other, Object.keys(new ns.geo.Point(1, 2)).join());
ns.geo.Point = function () { this.sum = () => 1; };
console.log(run(10));
ns.Pair = class { constructor(p, k) { this.q = p; } go() { return 2; } };
console.log(run(10));
