// STATISTIC: FractionFieldsStoredAsDoubles >= 1
// v.d[0] = i stores an int32, but Link has seen fractions in the arrays of the field: the preheader asks for doubles.
class Vector {
  constructor(x, y, z) {
    this.d = [x, y, z];
  }
  add(other) {
    this.d[0] += other.d[0];
    this.d[1] += other.d[1];
    this.d[2] += other.d[2];
    return this;
  }
}
const v = new Vector(0.5, 1.5, 2.5), w = new Vector(0.25, 0.5, 0.75);
function work(i) {
  v.d[0] = i;
  return v.add(w).d[0];
}
function run(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s = s * 0.5 + work(i);
  return s;
}
console.log(run(10), run(100), v.d.join(), w.d.join());
