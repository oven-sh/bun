// What a copy holds is what the source holds: the same inner objects, arrays and closures, not copies of them and not places in the copy's own cell.
const lines = [];
function copy(source) { return { ...source }; }
function copyAndAdd(source, value) { return { ...source, added: value }; }
function nested(i) { return { id: i, inner: { x: i, y: i + 1 }, list: [i, i + 1], deep: { deeper: { deepest: i } } }; }
function withClosures(i) { return { id: i, get: () => i, add(n) { return this.id + n; }, make: function () { return { from: i }; } }; }
const kept = [];
for (let i = 0; i < 5; i++) {
  const source = nested(i);
  const made = copy(source);
  lines.push("the same inner objects " + i + ": " + (made.inner === source.inner) + " " + (made.list === source.list) + " " + (made.deep === source.deep) + " " + (made.deep.deeper === source.deep.deeper));
  made.inner.x = "through the copy"; source.list.push("through the source"); source.deep.deeper.deepest = "deep";
  lines.push("seen on both sides " + i + ": " + source.inner.x + " | " + made.list + " | " + made.deep.deeper.deepest);
  made.inner = { x: "another", y: 0 };
  lines.push("replaced in the copy alone " + i + ": " + JSON.stringify(source.inner) + " " + JSON.stringify(made.inner));
  source.deep = null;
  lines.push("replaced in the source alone " + i + ": " + JSON.stringify(made.deep));
  kept.push(made, copyAndAdd(made, i), copy(copy(made)));
}
for (let i = 0; i < 5; i++) {
  const source = withClosures(i);
  const made = copyAndAdd(source, i);
  lines.push("closures " + i + ": " + (made.get === source.get) + " " + (made.add === source.add) + " " + made.get() + " " + made.add(10) + " " + JSON.stringify(made.make()));
  made.id = 100;
  lines.push("this is the copy " + i + ": " + made.add(1) + " " + source.add(1));
}
// The sources are garbage now; the copies keep what they hold.
function churn() { let junk = []; for (let i = 0; i < 20000; i++) junk.push({ a: i, b: [i], c: { d: i } }); return junk.length; }
for (let round = 0; round < 5; round++) { churn(); if (typeof Bun !== "undefined") Bun.gc(true); }
lines.push(JSON.stringify(kept));

// A record that is a constant of the program, copied and changed.
const defaults = { retries: 3, name: "default", limits: { low: 1, high: 9 }, tags: ["a", "b"] };
function configure(overrides) { return { ...defaults, ...overrides }; }
function fresh() { return { ...defaults }; }
for (let i = 0; i < 4; i++) {
  const one = fresh();
  one.retries += i; one.tags.push("t" + i); one.limits.high += i;
  lines.push("defaults " + i + ": " + JSON.stringify(one) + " " + JSON.stringify(defaults) + " " + JSON.stringify(configure({ name: "n" + i, extra: i })) + " " + JSON.stringify(configure(i & 1 ? undefined : null)));
}
console.log(lines.join("\n"));
