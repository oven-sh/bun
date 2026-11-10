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
const holedOutside = [[1, 2], , [3, 4]];
const said = [];
for (const d of [holedOutside, { length: 2, 0: [1, 2], 1: [3, 4] }, "ab", [], [[]], new Array(2)]) {
  try {
    said.push(call(d, 0));
  } catch (error) {
    said.push(error.constructor.name);
  }
}
console.log(
  said.join(`
`),
);
