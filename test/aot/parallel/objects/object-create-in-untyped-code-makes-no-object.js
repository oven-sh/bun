// What Object.create() makes in a loop of untyped code is never made. The copies of the loop for counters that are no int32 seldom run and still make it.
// COUNT: allCells <= 5000
const proto = {
  x: 0,
  y: 0,
  sum() {
    return this.x + this.y;
  },
};
function turn(i) {
  const v = Object.create(proto);
  v.x = i & 7;
  v.y = 2;
  return v.sum();
}
function bench(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
console.log(bench(20000), bench(2.5), bench("3"));
