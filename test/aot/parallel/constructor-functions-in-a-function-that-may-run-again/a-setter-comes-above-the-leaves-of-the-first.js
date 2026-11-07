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
function show(o) { return Object.keys(o).join() + "|" + [o.kind, o.pos, o.end, o.id, o.parent].join(); }
const first = world.shops.first = world.open("first");
for (let i = 0; i < 50; i++) made("first", i, i + 1, i + 2);
out.push(show(made("first", 1, 2, 3)));
Object.defineProperty(first.Leaf.prototype, "id", { set(v) { out.push("sets id " + v); }, get() { return "above"; }, configurable: true });
out.push(show(made("first", 4, 5, 6)));
delete first.Leaf.prototype.id;
out.push(show(made("first", 7, 8, 9)));
console.log(out.join("\n"));
