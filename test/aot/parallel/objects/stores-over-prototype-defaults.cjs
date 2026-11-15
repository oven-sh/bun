// Stores that create a name over a default on the prototype, in loops, until something stops them.
var log = [], effects = 0;
function make(change) {
  function Node(key) { this.key = key; }
  Node.prototype.left = null; Node.prototype.right = null; Node.prototype.size = 0;
  function link(node, other, n) { for (var i = 0; i < n; i++) { var next = new Node(i); next.left = node; next.right = other.left; other.right = next; next.size += i; if (next.left && next.left.right) next.left.right = next.right; node = next; } return node; }
  function walk(node) { var sum = 0, steps = 0; while (node && steps++ < 200) { sum = (sum * 31 + node.key + (node.size | 0)) | 0; if (!node.left) break; if (node.left.key < node.key && node.left.left) { var t = node.left; node.left = t.right; t.right = node; node = t; } else node = node.left; } return sum + " " + steps; }
  var a = new Node(-1), b = new Node(-2);
  log.push(walk(link(a, b, 30)));
  change(Node, a, b);
  for (var turn = 0; turn < 3; turn++) { var c = new Node(turn), d = new Node(turn + 1); log.push(walk(link(c, d, 20)), Object.keys(c).join(), Object.keys(d).join(), String(c.left), String(d.size)); }
}
make(function () {});
make(function (Node) { Object.defineProperty(Node.prototype, "left", { value: null, writable: false, configurable: true }); });
make(function (Node) { Object.defineProperty(Node.prototype, "size", { get: function () { effects++; return 3; }, set: function (v) { effects += v; }, configurable: true }); });
make(function (Node) { Object.freeze(Node.prototype); });
make(function (Node) { Object.defineProperties(Node.prototype, { right: { value: undefined, writable: false, enumerable: true } }); });
make(function (Node) { Object.setPrototypeOf(Node.prototype, { get left() { effects++; return null; } }); });
make(function (Node) { Reflect.defineProperty(Node.prototype, "left", { value: null, configurable: true }); delete Node.prototype.left; });
make(function (Node, a, b) { Object.freeze(a); Object.preventExtensions(b); delete Node.prototype.right; Node.prototype.right = 0; });
// One shape, orders of fields that differ by their count alone.
function Pair(key) { this.key = key; }
Pair.prototype.first = undefined; Pair.prototype.second = undefined; Pair.prototype.third = undefined;
function fill(i) { var p = new Pair(i); if (i & 1) p.second = i; if (i & 2) p.first = -i; if (!(i & 1)) p.second = i * 0.5; if (i % 3) p.third = p; if (!(i & 2)) p.first = "t" + i; return p; }
var keys = {};
for (var i = 0; i < 300; i++) { var p = fill(i), k = Object.keys(p).join(); keys[k] = (keys[k] || 0) + (p.third === p ? 1 : 1000); }
log.push(JSON.stringify(keys), effects);
for (var l = 0; l < log.length; l++) console.log(String(log[l]));
