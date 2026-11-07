function trample(depth) {
  let a = depth, b = a + 1, c = b + 1, d = c + 1;
  if (depth > 0) a += trample(depth - 1);
  return (a + b + c + d) | 0;
}
function setup(report) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  setTimeout(() => { trample(40); report(5); }, 0);
  return work;
}
function main() {
  let total = 1;
  const work = setup((n) => { total += n; console.log("timer", total); });
  return work;
}
console.log(main(), trample(60) > 0);
