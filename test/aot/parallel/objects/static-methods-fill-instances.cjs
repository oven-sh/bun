// `Vector.fill = function () { this.x = 0 }`: a static method of a constructor fills objects; some are constructed all the same.
var log = [], lib = {};
(function () {
  function V() { V.vector.apply(this, arguments); this.constructor === V && this.vector.apply(this, arguments); }
  function W() { W.other.apply(this, arguments); }
  W.prototype = Object.create(V.prototype); W.prototype.constructor = W;
  lib.V = V; lib.W = W;
})();
(function () {
  var V = lib.V, W = lib.W;
  V.vector = function () { this.x = 0; this.y = 0; };
  V.prototype.vector = function (x, y) { this.x = x; this.y = y; };
  V.prototype.sum = function () { return this.x + this.y; };
  V.prototype.move = function (by) { this.x = this.x + by; this.y = this.y - by; return this; };
  W.other = function (x) { this.y = x; this.x = "w" + x; };
  W.prototype.name = function () { return this.x + this.y; };
})();
function Tree(n) { this.nodes = []; Tree.count(n); Tree.setup.call(this, n); }
Tree.prototype.size = function () { return this.nodes.length; };
Tree.count = function (n) { this.total = (this.total || 0) + n; return this; };
Tree.setup = function (n) { this.left = n; this.right = n + 0.5; };
Tree.node = function (key) { this.key = key; this.next = null; };
Tree.prototype.add = function (key) { this.nodes.push(new Tree.node(key)); return this; };
Tree.late = function (a) { this.a = a; this.b = a + 1; };
Tree.late.prototype.both = function () { return this.a + this.b; };
Tree.bare = function () { if (this !== undefined && this !== globalThis) this.bare1 = 1; return typeof this; };
Tree.made = function (v) { this.v = v; this.w = v; if (v === 3) return { v: "other", w: 1 }; };
const made = Tree.made, key = "prototype";
Tree.made[key].get = function () { return this.v + this.w; };
var all = [], trees = [];
for (var i = 0; i < 24; i++) {
  all.push(i % 3 ? new lib.V(i, i * 0.5) : new lib.W(i));
  trees.push(new Tree(i).add(i).add("k" + i));
}
function sums(list) { var s = 0; for (var i = 0; i < 200; i++) { var o = list[i % list.length]; s += typeof o.x === "string" ? 1 : o.sum(); } return s; }
function moves(list) { for (var i = 0; i < 200; i++) { var o = list[i % list.length]; if (typeof o.x !== "string") o.move(1); } }
log.push(sums(all)); moves(all); log.push(sums(all));
for (var i = 0; i < 24; i += 5) log.push(Object.keys(all[i]).join() + " " + all[i].x + " " + all[i].y + " " + (all[i] instanceof lib.V) + " " + (all[i].name ? all[i].name() : ""));
log.push(Tree.total, trees[3].left, trees[3].right, trees[4].size(), Object.keys(trees[4].nodes[1]).join(), trees[5].nodes[0].key, trees[5].nodes[1].constructor === Tree.node);
var l = new Tree.late(4); log.push(l.both(), l instanceof Tree.late, Object.keys(l).join());
for (var i = 1; i < 6; i++) { var m = i & 1 ? new made(i) : Reflect.construct(Tree.made, [i]); log.push(m.v + " " + m.w + " " + (m instanceof made) + " " + (m.get ? m.get() : "none") + " " + Object.keys(m).join()); }
const bare = Tree.bare; log.push(bare(), Tree.bare(), Tree.bare1, bare.call(7), bare.call(undefined));
function sumMade(n) { var s = 0; for (var i = 0; i < n; i++) { var o = new made(i); s += typeof o.v === "string" ? 1 : o.v + o.w; } return s; }
log.push(sumMade(100));
lib.V.vector = function () { this.x = 9; }; log.push(new lib.V(1, 2).sum(), Object.keys(new lib.W(1)).join());
delete all[1].y; all[2].x = "text"; log.push(all[1].sum(), all[2].sum());
Object.defineProperty(lib.V.prototype, "x", { set: function (v) { this.seen = v; }, get: function () { return 100; }, configurable: true });
log.push(new lib.V(5, 6).sum(), new lib.V(5, 6).seen);
for (var j = 0; j < log.length; j++) console.log(String(log[j]));
