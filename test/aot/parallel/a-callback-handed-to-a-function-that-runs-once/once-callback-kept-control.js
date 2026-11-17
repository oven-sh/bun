const stored = [];
function setup(report) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  stored.push((n) => report(n));
  return work;
}
function main() {
  let total = 1;
  let work = setup((n) => { total += n; return total; });
  work += setup((n) => { total += n * 2; return total; });
  return work;
}
const work = main();
console.log(work, stored[0](5), stored[1](7));
