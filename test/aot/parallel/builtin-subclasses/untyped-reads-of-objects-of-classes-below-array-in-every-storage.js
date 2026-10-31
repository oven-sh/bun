class Bag extends Array {
  pick(i) { return this[i]; }
  list() { const out = []; for (let i = 0; i < this.length; i++) out.push(this[i]); return out; }
  walk() { const out = []; for (const v of this) out.push(v); return out; }
}
function show(tag, bag) {
  const parts = [];
  for (let turn = 0; turn < 3; turn++) parts.push(String(bag.pick(0)), String(bag.pick(1)), String(bag.pick(bag.length)), String(bag.pick(-1)), String(bag.pick(1.5)), String(bag.pick("0")), bag.list().map(String).join("|"), bag.walk().map(String).join("|"));
  console.log(tag, parts.join(" "));
}
function of(...items) { const b = new Bag(); for (const item of items) b.push(item); return b; }
for (let round = 0; round < 3; round++) {
  show("none", new Bag());
  show("ints", of(1, 2, 3));
  show("doubles", of(1.5, 2.5, NaN, -0));
  show("values", of("a", {}, null, undefined, 1));
  show("holes", new Bag(3));
  const some = new Bag(4); some[1] = 1; some[3] = 3.5; show("some", some);
  const sparse = of(1); sparse[100000] = 2; console.log("sparse", sparse.pick(0), sparse.pick(5), sparse.pick(100000), sparse.length);
  show("frozen", Object.freeze(of(1, 2)));
  const getter = of(1, 2, 3); Object.defineProperty(getter, 1, { get() { return "got"; } }); show("getter", getter);
  const turned = of(1, 2); show("turned", turned); turned.push(0.5); show("turned", turned); turned.push("s"); show("turned", turned); turned.length = 1; show("turned", turned);
  const named = of(1, 2); named.extra = 1; named[-1] = "minus"; named["1.5"] = "half"; show("named", named);
  show("text", Object.assign(Object.create(Bag.prototype), { 0: "x", length: 1 }));
}
Bag.prototype[1] = "above";
show("holes above", new Bag(3)); show("ints above", of(1, 2, 3)); show("short above", of(1));
delete Bag.prototype[1];
show("holes again", new Bag(3));
