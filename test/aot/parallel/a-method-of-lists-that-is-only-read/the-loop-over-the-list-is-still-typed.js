// STATISTIC: UnrolledLoopsForIndexingType >= 1
const D = JSON.parse("[[1.5,2,3,0.5],[3,4.5,1,2],[5,6,0.25,1]]");
function horner(c, x) {
  let s = 0;
  for (let i = c.length - 1; i >= 0; i--) s = s * x + c[i];
  return c.concat ? s : 0;
}
function run(d) {
  const said = [];
  for (const c of d) for (let x = 0; x < 3; x++) said.push(horner(c, x + 0.5));
  return said.join(" ");
}
console.log(run(D));
