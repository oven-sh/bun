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
const names = ["first"];
for (let i = 0; i < 6; i++) {
  const next = world.shops["n" + i] = world.open("n" + i);
  if (i === 2) Object.defineProperty(next.Leaf.prototype, "kind", { set(v) { out.push("third sets kind " + v); }, get() { return "third"; }, configurable: true });
  if (i === 4) next.Leaf.prototype = { set parent(v) { out.push("fifth sets parent " + v); }, get parent() { return "fifth"; } };
  names.push("n" + i);
  for (const name of names) out.push(name + ": " + show(made(name, i, i + 1, i + 2)));
}
console.log(out.join("\n"));
