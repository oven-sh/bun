// The methods of repeated-stores-recorded-once over arrays of any kind.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
class V {
  constructor(d) {
    this.d = d;
  }
  add(p) {
    this.d[0] += p.d[0];
    this.d[1] += p.d[1];
    return this;
  }
  twice(p) {
    this.d[1] = p.d[0] * 0.5;
    this.d[0] -= p.d[1];
    this.d[1] += this.d[0];
    return this;
  }
}
const list = [];
for (let k = 0; k < 12; k++) list.push(new V(k & 1 ? [k + 0.5, k * 0.25] : [k, k * 2]));
const w = new V([0.25, 0.5]);
function run(n) {
  let s = 0;
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < 12; i++) {
      list[i].d[0] = i * 0.5;
      s = s * 0.5 + list[i].add(w).twice(w).d[0];
    }
  }
  return s;
}
const state = () => list.map(v => Array.from(v.d, show).join()).join(" ") + " " + Array.from(w.d, show).join();
for (const d of [[1, 2], [0.5], ["a", 1], [1, , 2], Object.freeze([1, 2]), [0.5, NaN], new Float64Array(2)]) {
  for (let k = 0; k < 12; k++) list[k].d = k & 1 ? [k, 1] : [k + 0.5, 2];
  list[5].d = d;
  for (const other of [[1, 2], [0.5, 1.5], [1], ["1", 2], d]) {
    w.d = other;
    let out;
    try {
      out = show(run(1));
    } catch (e) {
      out = e.constructor.name;
    }
    console.log(out, state());
  }
}
