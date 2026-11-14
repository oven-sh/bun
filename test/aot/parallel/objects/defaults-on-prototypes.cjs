// Constructor functions whose prototypes hold defaults: primitives that objects hide once a name is stored on them.
var log = [], effects = 0;
function Tree() {}
Tree.prototype.root_ = null;
Tree.Node = function (key, value) { this.key = key; this.value = value; };
Tree.Node.prototype.left = null;
Tree.Node.prototype.right = null;
Tree.prototype.splay = function (key) {
  var dummy, left, right, current = this.root_;
  if (!current) return;
  dummy = left = right = new Tree.Node(null, null);
  while (true) {
    if (key < current.key) {
      if (!current.left) break;
      if (key < current.left.key) { var tmp = current.left; current.left = tmp.right; tmp.right = current; current = tmp; if (!current.left) break; }
      right.left = current; right = current; current = current.left;
    } else if (key > current.key) {
      if (!current.right) break;
      if (key > current.right.key) { var tmp = current.right; current.right = tmp.left; tmp.left = current; current = tmp; if (!current.right) break; }
      left.right = current; left = current; current = current.right;
    } else break;
  }
  left.right = current.left; right.left = current.right; current.left = dummy.right; current.right = dummy.left; this.root_ = current;
};
Tree.prototype.insert = function (key, value) {
  var node = new Tree.Node(key, value);
  if (!this.root_) { this.root_ = node; return; }
  this.splay(key);
  if (this.root_.key === key) return;
  if (key > this.root_.key) { node.left = this.root_; node.right = this.root_.right; this.root_.right = null; } else { node.right = this.root_; node.left = this.root_.left; this.root_.left = null; }
  this.root_ = node;
};
Tree.Node.prototype.walk = function (f) { var current = this; while (current) { if (current.left) current.left.walk(f); f(current); current = current.right; } };
function Item(i) { this.i = i; }
var early = new Item(-1), earlyCount = early.count;
Item.prototype.count = 0; Item.prototype.ratio = 0.5; Item.prototype.name = "none"; Item.prototype.on = true; Item.prototype.gone = undefined; Item.prototype.big = 1n;
function Child(i) { Item.call(this, i); }
Child.prototype = Object.create(Item.prototype); Child.prototype.count = 100; Child.prototype.constructor = Child;
function Held(i) { this.i = i; }
Held.prototype.at = 1; Held.prototype.by = 2; Held.prototype.to = 3;
function show(o) { var names = []; for (var k in o) names.push((Object.hasOwn(o, k) ? "" : "^") + k + "=" + (typeof o[k] === "function" ? "f" : String(o[k]))); return names.join() + "|" + Object.keys(o).join() + "|" + JSON.stringify(Object.assign({}, o), function (k, v) { return typeof v === "bigint" ? String(v) : v; }); }
function bump(list, turns) { var total = 0; for (var t = 0; t < turns; t++) { var o = list[t % list.length]; o.count++; o.ratio += o.count; if (!o.on) o.name += "!"; else o.on = t % 3 === 0; total += o.count + o.ratio; if (o.gone === undefined) o.gone = null; } return total; }
function sums(list, turns) { var total = 0, missing = 0; for (var t = 0; t < turns; t++) { var o = list[t % list.length]; total += o.count + o.ratio + o.name.length; if (o.gone == null) missing++; } return total + " " + missing; }
var tree = new Tree(), seed = 7, keys = [];
log.push(tree.root_, Object.hasOwn(tree, "root_"), show(new Tree.Node(1, 2)));
for (var i = 0; i < 400; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; tree.insert(i % 5 ? seed / 1024 : seed, i); if (i % 7 === 3) tree.splay(seed % 1000); }
tree.root_.walk(function (n) { keys.push(n.key); });
log.push(keys.length, keys.every(function (k, i) { return !i || keys[i - 1] < k; }), Object.keys(tree.root_).join(), Object.keys(tree).join());
var items = [early, new Item(0), new Item(1), new Child(2), new Item(3), new Child(4)];
log.push(earlyCount, early.count, sums(items, 40), bump(items, 37), sums(items, 40), items.map(show).join("\n"));
delete items[1].count; delete items[2].name; items[4].ratio = undefined; items[4].extra = 1;
log.push(sums(items.slice(0, 4), 30), items[1].count, items[2].name, show(items[4]));
Item.prototype.count = 1000; Item.prototype.name = "some"; delete Child.prototype.count;
log.push(items[1].count, new Item(9).count, new Child(9).count, new Item(9).name, sums([new Item(5), new Child(6)], 12));
var held = [];
for (var j = 0; j < 12; j++) {
  var h = new Held(j); held.push(h);
  if (j === 3) Object.defineProperty(Held.prototype, "at", { get: function () { effects++; return 50; }, set: function (v) { effects += 100; }, configurable: true });
  if (j === 6) Object.defineProperty(Held.prototype, "by", { value: 20, writable: false, configurable: true });
  if (j === 8) Object.freeze(Held.prototype);
  if (j === 10) Object.setPrototypeOf(h, { to: 33, at: 11, get by() { effects++; return 22; } });
  h.at = j; h.by = j; if (j & 1) h.to = -j;
}
for (var turn = 0; turn < 24; turn++) { var h2 = held[turn % 12]; h2.by = turn; h2.to += 1; }
log.push(held.map(function (h) { return [h.at, h.by, h.to, Object.keys(h).join("/")].join(); }).join(";"), effects);
for (var l = 0; l < log.length; l++) console.log(String(log[l]));
