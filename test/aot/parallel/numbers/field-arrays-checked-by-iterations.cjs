// STATISTIC: FieldArraysCheckedByIterations >= 2
// list[i].d[0] = x; list[i].add(w): the loop over the list is specialized although the stores may run other code; each iteration checks the arrays.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
class V {
  constructor(d) {
    this.d = d;
  }
  add(p) {
    this.d[0] += p.d[0];
    this.d[1] += p.d[1];
    this.d[2] += p.d[2];
    return this;
  }
}
const list = [];
for (let k = 0; k < 16; k++) list.push(new V(k & 1 ? [k + 0.5, k * 0.25, 3.5] : [k, k * 2, 7]));
const w = new V([0.25, 0.5, 0.75]);
function run(n) {
  let s = 0;
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < 16; i++) {
      list[i].d[0] = i * 0.5;
      s = s * 0.5 + list[i].add(w).d[0];
    }
  }
  return s;
}
function each(n) {
  let s = 0;
  for (let r = 0; r < n; r++) {
    for (const v of list) {
      v.d[0] = r * 0.5;
      v.add(w).add(w);
      s = s * 0.5 + v.d[1];
    }
  }
  return s;
}
const state = () => list.map(v => v.d.map(show).join()).join(" ") + " " + w.d.map(show).join();
console.log(show(run(3)), show(each(3)), state());
w.d = list[3].d;
console.log(show(run(2)), show(each(1)), state());
w.d = [1, 2, NaN];
console.log(show(run(2)), show(each(1)), state());
w.d = [1, 0.5, 1];
list[7].d.length = 1;
list[8].d = [1, 2, "3"];
list[9].d = [1, , 0.5];
console.log(show(run(1)), show(each(1)), state());
