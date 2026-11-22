const stored = [];
function trample(depth) {
  let a = depth, b = a + 1, c = b + 1, d = c + 1;
  if (depth > 0) a += trample(depth - 1);
  return (a + b + c + d) | 0;
}
function setup(report) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  stored.push((n) => report(n));
  return work;
}
function main() {
  let total = 1;
  const work = setup((n) => { total += n; return total; });
  return work;
}
const work = main();
const trodden = trample(60) > 0;
console.log(work, trodden, stored[0](5), stored[0](7));
