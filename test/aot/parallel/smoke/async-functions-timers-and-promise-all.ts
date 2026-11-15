// Async functions, timers and what Promise offers, a little of each.
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function double(n: number): Promise<number> {
  await sleep(1);
  return n * 2;
}
async function fails(): Promise<never> {
  await null;
  throw new Error("failed");
}
async function* ticks(count: number) {
  for (let i = 0; i < count; i++) {
    await sleep(1);
    yield i;
  }
}
const results = await Promise.all([double(1), double(2)]);
console.log(results);
try {
  await fails();
} catch (error) {
  console.log((error as Error).message);
}
for await (const tick of ticks(3)) console.log(tick);
console.log((await Promise.allSettled([double(3), fails()])).map(each => (each.status === "fulfilled" ? each.value : (each.reason as Error).message)));
const arrow = async () => (await double(4)) + 1;
arrow().then(console.log);
