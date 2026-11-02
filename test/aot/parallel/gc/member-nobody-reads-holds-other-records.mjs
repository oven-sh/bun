// Forty holders a row, kept in a list, each with a member that nothing reads. What that member holds, by itself or through other records, is known to a WeakRef, a WeakMap or a
// FinalizationRegistry: it is there for as long as its holder is.
const holders = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) holders.push(make(n, weak));
  rows.push({ name, weak });
}
const Alias = WeakRef;
const watch = (list, value) => (list.push(new WeakRef(value)), value);
row("the record itself", (n, weak) => {
  const w = { v: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: w };
});
row("a record in a record", (n, weak) => {
  const w = { w1: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: { inner: w } };
});
row("a record in a record in a record", (n, weak) => {
  const w = { w2: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: { a: { b: w } } };
});
row("four deep", (n, weak) => {
  const w = { w3: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: { c: { d: { e: { f: w } } } } };
});
row("watched by a helper", (n, weak) => ({ read: n, keep: { inner2: watch(weak, { w4: n }) } }));
row("watched through an alias", (n, weak) => {
  const w = { w5: n };
  weak.push(new Alias(w));
  return { read: n, keep: { inner3: w } };
});
row("watched by Reflect.construct", (n, weak) => {
  const w = { w6: n };
  weak.push(Reflect.construct(WeakRef, [w]));
  return { read: n, keep: { inner4: w } };
});
row("watched in a callback", (n, weak) => {
  const w = { w7: n };
  weak.push(...[w].map(x => new WeakRef(x)));
  return { read: n, keep: { inner5: w } };
});
const map = new WeakMap();
row("the key of a weak map whose value is watched", (n, weak) => {
  const key = { k1: n };
  const value = { x1: n };
  weak.push(new WeakRef(value));
  map.set(key, value);
  return { read: n, keep: key };
});
row("a record that holds such a key", (n, weak) => {
  const key = { k2: n };
  const value = { x2: n };
  weak.push(new WeakRef(value));
  map.set(key, value);
  return { read: n, keep: { holdsKey: key } };
});
const maps = [];
row("the key of a weak map made from a list", (n, weak) => {
  const key = { k3: n };
  const value = { x3: n };
  weak.push(new WeakRef(value));
  maps.push(new WeakMap([[key, value]]));
  return { read: n, keep: key };
});
row("stored later", (n, weak) => {
  const w = { w8: n };
  weak.push(new WeakRef(w));
  const inner = { late: null };
  inner.late = w;
  return { read: n, keep: inner };
});
row("added later", (n, weak) => {
  const w = { w9: n };
  weak.push(new WeakRef(w));
  const inner = { first: n };
  inner.added = w;
  return { read: n, keep: inner };
});
row("under a computed key", (n, weak) => {
  const w = { w10: n };
  weak.push(new WeakRef(w));
  const inner = { first2: n };
  inner["k" + (n & 1)] = w;
  return { read: n, keep: inner };
});
row("as a prototype", (n, weak) => {
  const w = { w11: n };
  weak.push(new WeakRef(w));
  const inner = { first3: n };
  Object.setPrototypeOf(inner, w);
  return { read: n, keep: inner };
});
row("in a list in a record", (n, weak) => {
  const w = { w12: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: { list: [w] } };
});
row("in a closure in a record", (n, weak) => {
  const w = { w13: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: { f: () => w } };
});
row("one of two kinds", (n, weak) => {
  const w = { w14: n };
  weak.push(new WeakRef(w));
  return { read: n, keep: n & 1 ? { either: w } : { or: w } };
});
let cleaned = 0;
const registry = new FinalizationRegistry(() => cleaned++);
row("registered", (n, weak) => {
  const w = { w15: n };
  registry.register(w, n);
  return { read: n, keep: { inner6: w } };
});
for (let round = 0; round < 6; round++) {
  Bun.gc(true);
  await new Promise(resolve => setTimeout(resolve, 1));
}
let sum = 0;
for (const holder of holders) sum += holder.read;
for (const { name, weak } of rows)
  console.log(name + ":", weak.filter(w => w.deref() !== undefined).length, "of", weak.length);
console.log("cleaned", cleaned, "sum", sum, holders.length);
