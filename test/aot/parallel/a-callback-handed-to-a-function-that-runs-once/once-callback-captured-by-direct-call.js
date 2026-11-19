function trample(depth) {
  let a = depth, b = a + 1, c = b + 1, d = c + 1;
  if (depth > 0) a += trample(depth - 1);
  return (a + b + c + d) | 0;
}
function setup(report) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  function tell(n) {
    let inner = 0;
    for (let i = 0; i < 2; i++) inner = (inner + i) | 0;
    report(n);
    return inner;
  }
  work += tell(0);
  work += tell(1);
  work += tell(2);
  Bun.gc(true);
  return work;
}
function main() {
  let total = 1;
  const work = setup((n) => { total += n; });
  Bun.gc(true);
  return total * 100 + work;
}
const answer = main();
const trodden = trample(60) > 0;
Bun.gc(true);
console.log(answer, trodden);
