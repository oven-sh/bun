function each(count, step) {
  let work = 0;
  for (let i = 0; i < count; i++) { step(i); work = (work + 1) | 0; }
  return work;
}
function setup(report) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  work += each(3, (n) => { report(n); });
  Bun.gc(true);
  return work;
}
function main() {
  let total = 1;
  const work = setup((n) => { total += n; });
  const junk = [];
  for (let i = 0; i < 20000; i++) junk.push({ i, text: "x" + i });
  Bun.gc(true);
  return total * 100 + work + (junk.length === 20000 ? 0 : 1);
}
const answer = main();
Bun.gc(true);
console.log(answer);
