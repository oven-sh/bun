// STATISTIC: ArraysGuardedInIterations >= 1
const D = JSON.parse("[[1.5,2,3],[3,4.5,1],[5,6,0.25],[7,8,9]]");
function one(d, a, b, n) {
  let sa = 0,
    sb = 0,
    ab = 0;
  for (let i = 0; i < n; i++) {
    sa = sa + d[i][a];
    sb = sb + d[i][b];
    ab = ab + d[i][a] * d[i][b];
  }
  return sa + "/" + sb + "/" + ab;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) said.push(one(d, a, b, d.length));
  return said.join(" ");
}
console.log(run(D));
