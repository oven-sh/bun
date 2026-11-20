// STATISTIC: RepeatedElementStoresRecordedOnce >= 1
// The second store of an iteration into the same element needs no record of its own: undoing the first restores the element.
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
console.log(show(run(3)), state());
w.d = list[2].d;
console.log(show(run(2)), state());
w.d = [1, NaN];
console.log(show(run(1)), state());
