let turns = 0;
function one(d, a, b) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const p = d[i][a] * d[i][b];
    sum += p === p ? p : 100;
    turns++;
  }
  return sum;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) said.push(one(d, a, b));
  return said.join(" ") + " in " + turns;
}
console.log(run([[], [7], [2, 3], new Array(2), [1.5, , 2.5], [, 4]]));
