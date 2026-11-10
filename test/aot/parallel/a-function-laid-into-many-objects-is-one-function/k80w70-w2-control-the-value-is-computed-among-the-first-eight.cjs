let calls = 0;
function measure(n) { calls++; return n * 2; }
function jobs(start, count) {
  let at = start;
  const onDone = () => ++at;
  const out = [];
  for (let i = 0; i < count; i++)
    out.push({ id: i, cost: measure(i), name: "job", tries: 0, limit: 3, first: true, last: false, now: () => at, next: null, onDone });
  return out;
}
jobs(1, 1);
const all = jobs(+(process.argv[2] ?? 7), 3);
console.log(all[0].onDone === all[1].onDone, all[0].onDone(), all[2].onDone(), all[1].now(), all[2].cost, calls);
