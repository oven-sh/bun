// STATISTIC: ArraysGuardedInIterations >= 1
function one(d, a) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum = sum + d[i][a];
  return typeof sum + " " + sum;
}
function run(d) {
  const said = [];
  for (let a = 0; a < 3; a++) said.push(one(d, a));
  return said.join(" . ");
}
console.log(run(JSON.parse('[["a",1,2.5],["b",2,"c"],["d",3,4]]')));
console.log(run(JSON.parse('[[1,1,2.5],[2,{"x":1},[7]],[3,null,4]]')));
