// STATISTIC: GeneratorFramesBuilt >= 4
// A resumed generator reads a constant object of its file that its first read makes.
const notes = [], kept = [];
const pick = name => (process.argv.length < 0 ? "" : name);
const show = v => JSON.stringify(v, (k, x) => (x === undefined ? "u" : x));
const engines = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
const names = { aa: 1, bb: 2, cc: 3 }, weights = { light: 1, heavy: { most: 9 } };
const experiments = {
  names(override) {
    function* items(limit) { for (let i = 0; i < limit; i++) for (const k in names) { const got = yield k + i; if (got === 5) break; } return names.bb; }
    console.log(show(items(1).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return () => { let n = 0; for (const v of items(3)) { n += hidden.value; if (n > 1) break; } return n; };
  },
  weights(override) {
    function* items(limit) { const read = weights; for (let i = 0; i < limit; i++) { yield i; notes.push(read === weights, read.heavy.most + i); } return Object.keys(read).join(); }
    console.log(show(items(1).next().value));
    const hidden = { get value() { Reflect.set(items.prototype, pick("return"), override); return 1; } };
    return () => { let n = 0; for (const v of items(3)) { n += hidden.value; if (n > 1) break; } return n; };
  },
};
const overrides = {
  keeps() { kept.push(this); return {}; },
  steps(value) { notes.push(show(engines.next.call(this, 8)), show(engines.next.call(this, 9))); return engines.return.call(this, value); },
  leaves(value) { notes.push(show(engines.return.call(this, value))); return {}; },
};
for (const [form, experiment] of Object.entries(experiments)) {
  for (const [name, override] of Object.entries(overrides)) {
    console.log(form, name, experiment(override)(), notes.splice(0).join(" "));
    for (const generator of kept.splice(0)) {
      const all = [];
      for (let step = 1; step < 8; step++) all.push(show(engines.next.call(generator, step)));
      console.log("  later", all.join(), show(engines.return.call(generator, 4)), notes.splice(0).join(" "));
    }
  }
}
