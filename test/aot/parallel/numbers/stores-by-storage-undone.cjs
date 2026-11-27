// STATISTIC: UndoableStoresByStorage >= 3
// v.d[0] = i * 0.5; v.add(w): the array holds doubles or int32s. The stores of the caller and of the copied method are undone where a later check fails.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
class V {
  constructor(x, y, z) {
    this.d = [x, y, z];
  }
  add(p) {
    this.d[0] += p.d[0];
    this.d[1] += p.d[1];
    this.d[2] += p.d[2];
    return this;
  }
}
const list = [];
for (let k = 0; k < 16; k++) list.push(k & 1 ? new V(k + 0.5, k * 0.25, 3.5) : new V(k, k * 2, 7));
const w = new V(0.25, 0.5, 0.75);
function work(i) {
  list[i].d[0] = i * 0.5;
  return list[i].add(w).d[0];
}
function run(n) {
  let s = 0;
  for (let r = 0; r < n; r++) for (let i = 0; i < 16; i++) s = s * 0.5 + work(i);
  return s;
}
function state() {
  return list.map(v => v.d.map(show).join()).join(" ") + " " + w.d.map(show).join();
}
console.log(show(run(3)), state());
w.d = [1, 2, 3];
console.log(show(run(2)), state());
w.d = [1, 2, NaN];
console.log(show(run(2)), state());
w.d = [1, 2];
console.log(show(run(1)), state());
w.d = [0.5, 1, 0.5];
list[5].d = [1, 2];
list[6].d = [1, 2, 3];
list[7].d = [0.5, , 1.5];
console.log(show(run(2)), state());
