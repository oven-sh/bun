// `await f(x)` where f is async, never suspends and answers a number or throws. The caller goes on after as many jobs of the queue as with a promise, whichever of the two happens,
// and what is thrown arrives at the await: inside its try, after the finally blocks of nothing else.
const log: string[] = [];
async function half(n: number): Promise<number> {
  if (n % 5 === 3) throw new RangeError("no half of " + n);
  return n >> 1;
}
async function text(n: number): Promise<string> {
  if (n % 4 === 1) throw "thrown " + n;
  return "t" + n;
}
async function walker(name: string, from: number, to: number): Promise<number> {
  let sum = 0;
  for (let i = from; i < to; i++) {
    try {
      sum += await half(i);
      log.push(name + i);
      sum += (await text(i)).length;
    } catch (error) {
      log.push(name + " caught " + (error instanceof Error ? error.message : String(error)));
    } finally {
      sum++;
    }
  }
  return sum;
}
async function unguarded(n: number): Promise<number> {
  const a = await half(n);
  log.push("unguarded went on with " + a);
  return a + (await half(a));
}
function ticks(name: string, count: number): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(() => void log.push(name + i));
  return chain;
}
const results = await Promise.allSettled([
  walker("a", 0, 9),
  ticks("tick", 30),
  walker("b", 3, 12),
  unguarded(8),
  unguarded(3),
  unguarded(6),
]);
console.log(log.join(" "));
console.log(
  JSON.stringify(results.map(result => (result.status === "fulfilled" ? result.value : String(result.reason)))),
);
let total = 0;
for (let round = 0; round < 3000; round++) total += await walker("", round, round + 3);
console.log(total, log.length);
