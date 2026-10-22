// Each store is an object that only the async context refers to while the function that entered it is suspended: on a pending promise, on a call, on a queued job.
// The collector runs in between, and the store has to be there afterwards.
const { AsyncLocalStorage } = require("node:async_hooks");
const storage = new AsyncLocalStorage();
let resolvers = [];
const pending = () => new Promise(resolve => resolvers.push(resolve));
async function suspendsOnce(value) {
  await null;
  return value;
}
async function waits(i) {
  await pending();
  const afterPromise = storage.getStore().i;
  await suspendsOnce(i);
  const afterCall = storage.getStore().i;
  await i;
  return afterPromise === i && afterCall === i && storage.getStore().i === i && storage.getStore().filler.length === 64;
}
async function main() {
  let right = 0;
  for (let round = 0; round < 40; round++) {
    const waiting = [];
    for (let i = 0; i < 50; i++) waiting.push(storage.run({ i, filler: new Array(64).fill(round) }, () => waits(i)));
    Bun.gc(true);
    const resolveAll = resolvers;
    resolvers = [];
    for (const resolve of resolveAll) resolve();
    Bun.gc(true);
    for (const answer of await Promise.all(waiting)) right += answer ? 1 : 0;
    const garbage = [];
    for (let i = 0; i < 2000; i++) garbage.push({ i, text: "x" + i });
  }
  console.log(right, storage.getStore());
}
main();
