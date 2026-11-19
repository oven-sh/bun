// STATISTIC: ArraysGuardedInIterations >= 1
const log = [];
function one(d, a, b, n) {
  let sa = 0,
    ab = 0;
  for (let i = 0; i < n; i++) {
    sa = sa + d[i][a];
    ab = ab + d[i][a] * d[i][b];
  }
  return sa + "/" + ab;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) said.push(one(d, a, b, d.length));
  return said.join(" ");
}
const d = JSON.parse("[[1.5,2],[3,4.5],[5,6],[7,8]]");
d[1][0] = {
  valueOf() {
    log.push("asked");
    d[1] = [log.length, 10];
    d[2][1] = d[2][1] + 0.5;
    d[3] = new Float64Array([log.length, 2]);
    return 3;
  },
};
console.log([run(d), JSON.stringify(d), log.join()].join("\n"));
