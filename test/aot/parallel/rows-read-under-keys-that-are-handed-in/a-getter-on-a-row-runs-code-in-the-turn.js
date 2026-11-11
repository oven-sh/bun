// STATISTIC: ArraysGuardedInIterations >= 1
const log = [];
function one(d, a, b) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum = sum + d[i][a] * d[i][b];
  return sum;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) said.push(one(d, a, b));
  return said.join(" ");
}
const d = JSON.parse("[[1.5,2],[3,4.5],[5,6],[7,8]]");
Object.defineProperty(d[1], 0, {
  get() {
    log.push("read");
    d[2] = [100 + log.length, 100];
    d[3][1] = String(log.length);
    return 3;
  },
});
console.log([run(d), JSON.stringify(d), log.join()].join("\n"));
