// STATISTIC: ListsAskedInTurnsOfTypedCopies >= 1
const D = JSON.parse("[[1.5,2,3],[3,4.5,1],[5,6,0.25],[7,8,9]]");
function one(d, a) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum = sum + d[i][a];
  return sum;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 4; a++) said.push(one(d, a));
  return said.join(" ");
}
console.log(run(D));
