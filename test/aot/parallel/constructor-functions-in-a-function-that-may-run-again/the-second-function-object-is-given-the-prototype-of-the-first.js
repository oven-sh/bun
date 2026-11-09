const out = [];
function workshop(label) {
  function Leaf(kind, pos, end) { this.kind = kind; this.pos = pos; this.end = end; this.id = 0; this.parent = null; }
  function make(k, p, e) { return new Leaf(k, p, e); }
  return { Leaf, make, label };
}
const world = globalThis;
world.open = workshop;
world.shops = {};
function made(name, k, p, e) { return world.shops[name].make(k, p, e); }
function show(o) { return Object.keys(o).join() + "|" + [o.kind, o.pos, o.end, o.id, o.parent].join() + "|" + (o instanceof first.Leaf) + (o instanceof second.Leaf) + (o.constructor === first.Leaf); }
const first = world.shops.first = world.open("first");
for (let i = 0; i < 50; i++) made("first", i, i + 1, i + 2);
const second = world.shops.second = world.open("second");
second.Leaf.prototype = first.Leaf.prototype;
out.push(show(made("second", 4, 5, 6)), show(made("first", 7, 8, 9)));
Object.defineProperty(first.Leaf.prototype, "kind", { set(v) { out.push("the one prototype sets kind " + v); }, get() { return "above"; }, configurable: true });
out.push(show(made("second", 4, 5, 6)), show(made("first", 7, 8, 9)));
console.log(out.join("\n"));
