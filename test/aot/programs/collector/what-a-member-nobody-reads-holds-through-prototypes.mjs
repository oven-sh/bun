// Forty holders a row, kept in a list, each with a member that nothing reads. The member holds an object whose prototype holds what a WeakRef knows.
const holders = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) holders.push(make(n, weak));
  rows.push({ name, weak });
}
const watch = (weak, value) => (weak.push(new WeakRef(value)), value);
row("Object.create of a record that holds it", (n, weak) => ({
  read: n,
  keep: Object.create({ held1: watch(weak, { p1: n }) }),
}));
row("Object.create of the watched record", (n, weak) => ({ read: n, keep: Object.create(watch(weak, { p2: n })) }));
row("__proto__ in a literal holds it", (n, weak) => ({
  read: n,
  keep: { __proto__: { held3: watch(weak, { p3: n }) }, own3: 1 },
}));
row("__proto__ in a literal is watched", (n, weak) => ({
  read: n,
  keep: { __proto__: watch(weak, { p4: n }), own4: 1 },
}));
row("__proto__ in an empty literal", (n, weak) => ({ read: n, keep: { __proto__: watch(weak, { p5: n }) } }));
row("two steps up", (n, weak) => ({ read: n, keep: { __proto__: { __proto__: watch(weak, { p6: n }) }, own6: 1 } }));
row("Object.create with descriptors", (n, weak) => ({
  read: n,
  keep: Object.create(watch(weak, { p7: n }), { own7: { value: 1 } }),
}));
row("Object.setPrototypeOf in the maker", (n, weak) => ({
  read: n,
  keep: Object.setPrototypeOf({ own8: 1 }, watch(weak, { p8: n })),
}));
row("in a record in the member", (n, weak) => ({
  read: n,
  keep: { inner9: { __proto__: watch(weak, { p9: n }), own9: 1 } },
}));
function Made10() {
  this.a = 1;
}
row("a function whose prototype is replaced for each holder", (n, weak) => {
  Made10.prototype = watch(weak, { p10: n });
  return { read: n, keep: new Made10() };
});
row("a function made for each holder", (n, weak) => {
  function Made11() {
    this.a = 1;
  }
  weak.push(new WeakRef(Made11.prototype));
  return { read: n, keep: new Made11() };
});
for (let round = 0; round < 6; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
let sum = 0;
for (const holder of holders) sum += holder.read;
for (const { name, weak } of rows)
  console.log(name + ":", weak.filter(w => w.deref() !== undefined).length, "of", weak.length);
console.log("sum", sum, holders.length);
