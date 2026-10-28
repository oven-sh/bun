// Chains of 100,000 tail calls between a function of the program and a function made by new Function() are started by a constructor that returns what the chain returns,
// by async functions before and behind an await, and by a generator. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
function Made(n) {
  this.n = n;
  return made(n);
}
function plain(n) {
  if (n <= 0) return { from: "plain" };
  return made(n - 1);
}
function back(n, sum) {
  if (n <= 0) return sum;
  return counting(n - 1, sum + 1);
}
Object.assign(globalThis, { Made, plain, back });
const made = new Function("n", '"use strict"; if (n === 7) return 7; return plain(n);' + never);
const counting = new Function("n", "sum", '"use strict"; return back(n, sum);' + never);
console.log(JSON.stringify(new Made(7)), JSON.stringify(new Made(100000)));
const maker = new Function("n", '"use strict"; return new Made(n);' + never);
console.log(JSON.stringify(maker(7)), JSON.stringify(maker(100000)));

async function waits(n) {
  const a = await counting(n, 0);
  return back(n, a);
}
function* yields(n) {
  yield counting(n, 0);
  return back(n, 1);
}
console.log([...yields(100000)].join(), yields(5).next().value);
const madeAsync = new Function("n", '"use strict"; return (async () => { const a = await back(n, 0); return back(n, a); })();' + never);
console.log(await waits(100000), await madeAsync(100000));
