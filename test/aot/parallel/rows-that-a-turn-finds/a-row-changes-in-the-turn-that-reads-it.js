// The turns store into lists, so no row is asked in them.
// STATISTIC: ListsAskedInTurnsOfTypedCopies = 0
const steps = JSON.parse(`["run"]`);
const ops = { run };
function call(d, t) {
  return ops[steps[0]](d, t);
}
function run(d, t) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const before = d[i][0];
    d[i][0] = d[i][1] + 1;
    sum += before * d[i][0];
    if (t === 1) d[i].length = 1;
    sum += d[i][1] === undefined ? 1000 : d[i][1];
    if (t === 2) d[(i + 1) % d.length] = ["x", "y"];
    if (t === 3) d[i].push(0.5);
    if (t === 4) d[i][1] = "text";
  }
  return sum;
}
const said = [];
for (let t = 0; t < 6; t++) {
  const d = JSON.parse("[[1.5,2],[3,4.5],[5,6]]");
  said.push(call(d, t) + " " + JSON.stringify(d));
}
console.log(
  said.join(`
`),
);
