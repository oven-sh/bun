const { AsyncLocalStorage, AsyncResource } = require("node:async_hooks");
const storage = new AsyncLocalStorage();
let sum = 0;
const later = value => new Promise(resolve => queueMicrotask(() => resolve(value)));
async function chain(n) { let total = 0; for (let i = 0; i < n; i++) total += await later(i); return total; }
async function* counted(n) { for (let i = 0; i < n; i++) yield i; }
async function main() {
  for (let round = 0; round < 300; round++) {
    sum += await chain(40);
    sum += (await Promise.all(Array.from({ length: 40 }, (_, i) => later(i)))).length;
    sum += (await Promise.allSettled([later(1), Promise.reject(new Error("no"))])).length + (await Promise.race([later(2), later(3)]));
    for await (const value of counted(30)) sum += value;
    sum += await storage.run({ round }, async () => { await later(0); return storage.getStore().round; });
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => setImmediate(resolve));
  }
  for (let i = 0; i < 100000; i++) sum += storage.run(i, () => storage.getStore());
  const resource = new AsyncResource("row");
  for (let i = 0; i < 100000; i++) sum += resource.runInAsyncScope(() => 1);
  let ticks = 0;
  await new Promise(resolve => { const tick = () => (++ticks < 60000 ? process.nextTick(tick) : resolve()); tick(); });
  console.log(sum + ticks);
}
main();
