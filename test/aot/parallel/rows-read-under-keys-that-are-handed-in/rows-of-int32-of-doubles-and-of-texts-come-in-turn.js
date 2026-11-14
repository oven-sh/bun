// STATISTIC: ArraysGuardedInIterations >= 1
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
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) said.push(one(d, a, b) + " " + turns);
  return said.join(" . ");
}
console.log(run(JSON.parse('[[1,2],[1.5,2],["3",2],[2,2],[null,1],[true,3],["x",1]]')));
