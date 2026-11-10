// STATISTIC: ListsAskedInTurnsOfTypedCopies >= 1
const steps = JSON.parse(`["run"]`);
const ops = { run };
function call(d, t) {
  return ops[steps[0]](d, t);
}
function run(d, t) {
  let products = 0;
  let missing = 0;
  let outside = 0;
  for (let i = 0; i < d.length; i++) {
    products += d[i][0] * d[i][1];
    if (d[i][1] === undefined) missing++;
    if (d[i][7] === undefined) outside++;
  }
  return [products, missing, outside, t].join();
}
const whole = JSON.parse("[[1.5,2],[3,4.5],[5,6]]");
const holed = [[1.5, 2], [3, , 4.5], [, 6], []];
const said = [];
for (let t = 0; t < 3; t++) said.push(call(whole, t), call(holed, t));
console.log(
  said.join(`
`),
);
