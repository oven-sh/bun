// STATISTIC: ArraysGuardedForReads >= 3
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; }
  set(a, b, c, d, e, f, g, h, i) {
    const te = this.elements;
    te[0] = a; te[1] = d; te[2] = g; te[3] = b; te[4] = e; te[5] = h; te[6] = c; te[7] = f; te[8] = i;
    return this;
  }
  setFrom(m) {
    const me = m.elements;
    this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10]);
    return this;
  }
  textOf(m) {
    const me = m.elements;
    return join(me[0], me[4], me[8], me[1], me[5], me[9], me[2]);
  }
  listOf(m) {
    const me = m.elements;
    const a = me[3], b = me[1], c = me[3], d = me[0], e = me[2], f = me[5], g = me[4];
    return [a, b, c, d, e, f, g, Object.is(a, c)];
  }
  // The method changes the list that it was handed the elements of.
  shift(a, b, c, d, e, f) {
    const te = this.elements;
    te[0] = f; te[1] = e; te[2] = d; te[3] = c; te[4] = b; te[5] = a;
    return te[0] === a;
  }
  shiftFrom(m) {
    const me = m.elements;
    return this.shift(me[0], me[1], me[2], me[3], me[4], me[5]);
  }
}
function join(a, b, c, d, e, f, g) { return a + "," + b + "," + c + "," + d + "," + e + "," + f + "," + g + "," + typeof f; }
globalThis.KEPT = [Matrix];
const log = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "[" + Array.from(v, show).join(" ") + "]" : typeof v === "bigint" ? v + "n" : String(v);
const of = f => Array.from({ length: 12 }, (_, i) => f(i));
const kinds = {
  fractions: () => of(i => i + 0.5),
  integers: () => of(i => i - 3),
  born: () => new Matrix().elements,
  mixed: () => of(i => i % 3 ? i + 0.25 : "t" + i),
  holes: () => { const a = of(i => i + 0.5); delete a[4]; delete a[2]; return a; },
  numbers: () => of(i => [NaN, -0, 0, Infinity, -Infinity, 5e-324, 2 ** 31, 2 ** 53 + 2, -(2 ** 31) - 1, 1e308, 0.1, 3][i]),
  undefineds: () => of(i => i === 5 ? undefined : i + 0.5),
  bigints: () => of(i => i === 1 ? 7n : i + 0.5),
  short: () => [1.5, 2.5, 3.5],
  views: () => Float64Array.from(of(i => i + 0.5)),
  frozen: () => Object.freeze(of(i => i + 0.5)),
  accessor: () => { const a = of(i => i + 0.5); Object.defineProperty(a, 4, { get() { log.push("get 4"); a[1] = "changed"; return 9.5; }, set(v) { log.push("set 4 " + show(v)); }, configurable: true }); return a; },
  proxy: () => new Proxy(of(i => i + 0.5), { get(t, k) { if (typeof k === "string" && k.length < 3) log.push(k); return t[k]; } }),
  like: () => ({ 0: 1.5, 1: 2, 4: 3.25, length: 6 }),
};
function run(list, how) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = new Matrix();
    switch (how) {
    case 0: out.push(show(t.setFrom(list[i]).elements)); break;
    case 1: out.push(t.textOf(list[i])); break;
    case 2: out.push(show(t.listOf(list[i]))); break;
    default: out.push(show(list[i].shiftFrom(list[i])), show(list[i].elements)); break;
    }
  }
  return out.join(" | ");
}
for (const kind of Object.keys(kinds)) {
  for (let how = 0; how < 4; how++) {
    const m = new Matrix();
    m.elements = kinds[kind]();
    log.length = 0;
    let result;
    try { result = run([m, new Matrix(), m], how); } catch (e) { result = e.constructor.name; }
    console.log(kind, how, result, log.join(" "));
  }
}
console.log(show(run([{ elements: kinds.fractions() }], 0)), run([{ get elements() { log.push("elements"); return kinds.fractions(); } }], 1));
