// STATISTIC: ArraysGuardedInIterations >= 1
const steps = JSON.parse(`["run"]`);
const ops = { run };
let turns = 0;
function call(d) {
  try {
    return ops[steps[0]](d);
  } catch (error) {
    return error.name;
  }
}
function run(d) {
  let sum = 0;
  let nothing = 0;
  for (let i = 0; i < d.length; i++) {
    const product = d[i][0] * d[i][1];
    sum += product === product ? product : 100;
    if (d[i][1] === undefined) nothing++;
    turns++;
  }
  return sum + " " + nothing;
}
const said = [];
for (const rows of [
  [
    [1, 2],
    [3, , "x"],
    [5, 6],
  ],
  [
    [1, 2],
    [3, undefined, "x"],
    [5, 6],
  ],
  [
    [1, "2", "x"],
    [, 4, "x"],
    [5, 6, "x"],
  ],
  [
    [1, 2, {}],
    [3, 4, {}],
    [undefined, undefined, {}],
  ],
  [[1, 2, null], [3], [5, 6, null]],
]) {
  turns = 0;
  said.push(call(rows) + " " + turns);
}
console.log(said.join("\n"));
