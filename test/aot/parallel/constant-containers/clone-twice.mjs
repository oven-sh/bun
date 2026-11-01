function mk() { return [[1, 2], [3, 4]]; }
function run() {
  const a = mk()[0];
  const b = mk()[0];
  const r = structuredClone({ x: a, y: b }); r.x[0] = 9;
  return String(r.y[0]);
}
console.log(run());
console.log(run());
