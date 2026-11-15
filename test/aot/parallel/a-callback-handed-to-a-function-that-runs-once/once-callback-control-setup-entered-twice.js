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
  let work = setup((n) => { total += n; });
  work += setup((n) => { total += n * 2; });
  Bun.gc(true);
  return total * 100 + work;
}
const answer = main();
Bun.gc(true);
console.log(answer);
