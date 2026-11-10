// STATISTIC: ListsAskedInTurnsOfTypedCopies >= 1
const steps = JSON.parse(`["run"]`);
const ops = { run };
function call(d, t) {
  return ops[steps[0]](d, t);
}
function run(d, t) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i][0] * d[i][1];
  return sum + t;
}
const d = JSON.parse("[[1.5,2],[3,4.5],[5,6],[7,8]]");
const log = [];
Object.defineProperty(d[1], 0, {
  get() {
    log.push("read");
    d[2] = [100, 100];
    d[3][1] = "9";
    return 3;
  },
});
const said = [call(d, 0), call(d, 1), JSON.stringify(d), log.join()];
console.log(
  said.join(`
`),
);
