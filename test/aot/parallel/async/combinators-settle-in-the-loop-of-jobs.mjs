// COUNTER: AsyncFunctionsResumedByRuntime <= 60
// The jobs of Promise.race and Promise.allSettled run between functions that wait, in the order of plain jobs.
import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(String(text));
const storage = new AsyncLocalStorage();
const later = value => new Promise(resolve => setImmediate(() => resolve(value)));
const laterFails = text => new Promise((_, reject) => setImmediate(() => reject(new Error(text))));
const describe = list => list.map(x => (x.status === "fulfilled" ? "+" + x.value : "-" + (x.reason instanceof Error ? x.reason.message : x.reason)) + Object.keys(x).join("")).join(" ");

async function ticks(name, count) {
  for (let tick = 0; tick < count; tick++) {
    await 0;
    log(name + tick);
  }
}

async function races() {
  let sum = 0;
  for (let k = 0; k < 40; k++) sum += await Promise.race([Promise.resolve(k), Promise.resolve(100)]);
  log("races " + sum);
  sum = 0;
  for (let k = 0; k < 40; k++) sum += await Promise.race([new Promise(() => {}), Promise.resolve(k), Promise.reject(new Error("late"))]);
  log("races " + sum);
  const promise = Promise.race([Promise.resolve("first"), Promise.resolve("second")]);
  promise.extra = 1;
  log((await promise) + promise.extra);
  log(await Promise.race([Promise.resolve({ then: 5 }), 1]).then(x => typeof x));
  try { await Promise.race([Promise.reject(new Error("rejected")), Promise.resolve(1)]); } catch (e) { log(e.message); }
  log(await Promise.race([later("later"), laterFails("no")]));
  log(await Promise.race([{ then(f) { log("then"); f("thenable"); } }, later(1)]));
  const held = Promise.resolve(3);
  log((await Promise.race([held, held, held])) + (await Promise.race([7, held])));
}

async function settlements() {
  let sum = 0;
  for (let k = 0; k < 40; k++) {
    const list = await Promise.allSettled([Promise.resolve(k), Promise.reject(k)]);
    sum += list[0].value + list[1].reason;
    list[0].status = "changed";
  }
  log("settled " + sum);
  log(describe(await Promise.allSettled([1, Promise.resolve("two"), Promise.reject("three"), later(4), laterFails("five"), { then(f, r) { r("six"); } }])));
  log(describe(await Promise.allSettled([])));
  const list = await Promise.allSettled([Promise.resolve(1), Promise.reject(2)]);
  log(JSON.stringify(list) + (Object.getPrototypeOf(list[0]) === Object.prototype) + Object.isExtensible(list[1]));
  const many = await Promise.allSettled(Array.from({ length: 60 }, (_, k) => (k % 3 ? Promise.resolve([k]) : Promise.reject({ k }))));
  log(many.map(x => (x.value ? x.value[0] : -x.reason.k)).join());
}

async function contexts() {
  await storage.run("a", async () => {
    log(await Promise.race([Promise.resolve(1), later(2)]) + storage.getStore());
    log(describe(await Promise.allSettled([Promise.resolve(1), later(2)])) + storage.getStore());
  });
  log(String(storage.getStore()));
}

await Promise.all([races(), ticks("r", 30)]);
await Promise.all([settlements(), ticks("s", 30)]);
await contexts();
console.log(out.join("\n"));
