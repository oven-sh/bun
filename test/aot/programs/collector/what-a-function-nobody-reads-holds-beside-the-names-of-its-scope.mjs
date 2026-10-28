// Forty scopes a row, each kept through one of its functions. Another function of the scope is only called, or never used, and captures an object that a WeakRef knows.
// The object is there for as long as the scope is, and for as long as a function that calls such a function behind an await is suspended.
const kept = [];
const rows = [];
function row(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) kept.push(make(n, weak));
  rows.push({ name, weak });
}
const watched = (weak, value) => (weak.push(new WeakRef(value)), value);

row("a parameter that two functions read", (n, weak) => {
  function scope(held) {
    const first = () => held.n;
    const second = () => first() + held.n;
    return () => second() + n;
  }
  return scope(watched(weak, { n }));
});
row("a parameter that only the function nobody uses reads", (n, weak) => {
  function scope(held) {
    const unused = () => held.n;
    return () => (n < 0 ? unused() : n);
  }
  return scope(watched(weak, { n }));
});
row("a constant of an inner block", (n, weak) => {
  function scope(held) {
    const results = [];
    {
      const inner = held;
      const reads = () => inner.n;
      results.push(() => reads() + n);
    }
    return results[0];
  }
  return scope(watched(weak, { n }));
});

const pending = [];
const release = [];
function rowOfSuspended(name, make) {
  const weak = [];
  for (let n = 0; n < 40; n++) pending.push(make(n, weak, new Promise(resolve => release.push(resolve))));
  rows.push({ name, weak });
}
rowOfSuspended("called behind an await", async (n, weak, gate) => {
  const held = watched(weak, { n });
  const reads = () => held.n;
  const twice = () => reads() + reads();
  await gate;
  return twice();
});
rowOfSuspended("called behind an await, and by a function that leaves", async (n, weak, gate) => {
  const held = watched(weak, { n });
  const reads = () => held.n;
  const twice = () => reads() + reads();
  kept.push(() => twice() + 1);
  await gate;
  return twice();
});

async function collect() {
  for (let round = 0; round < 6; round++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
const count = () =>
  rows
    .map(({ name, weak }) => `${name}: ${weak.filter(w => w.deref() !== undefined).length} of ${weak.length}`)
    .join("\n");
await collect();
console.log(count());
for (const resolve of release) resolve();
let sum = 0;
for (const value of await Promise.all(pending)) sum += value;
for (const call of kept) sum += call();
console.log("sum", sum);
