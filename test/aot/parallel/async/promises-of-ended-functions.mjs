import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(String(text));
const storage = new AsyncLocalStorage();
const show = value =>
  value === null || typeof value !== "object" ? `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}` : value instanceof Promise ? "promise" : `{${Object.keys(value)}}`;

const ends = [
  undefined,
  null,
  0,
  -0,
  NaN,
  2 ** 53,
  0.5,
  "text",
  "ro".repeat(2) + "pe",
  10n ** 20n,
  Symbol.for("symbol"),
  true,
  {},
  [1, 2],
  Object.freeze({ frozen: 1 }),
  () => {},
  Promise.resolve("inner"),
  { then: resolve => resolve("thenable") },
  { then: 5 },
  Object.create(null),
];
async function endsWith(value, waits) {
  for (let k = 0; k < waits; k++) await null;
  return value;
}
async function failsWith(value, waits) {
  for (let k = 0; k < waits; k++) await null;
  throw value;
}
async function ticks(name, count) {
  for (let tick = 0; tick < count; tick++) {
    log(name + tick);
    await null;
  }
}
async function quiet(count) {
  for (let tick = 0; tick < count; tick++) await null;
}
async function* awaitsInGenerator(promise) {
  yield await promise;
  yield promise;
}

const waiters = {
  then: promise => promise.then(value => log("then " + show(value)), error => log("else " + show(error))),
  fulfilled: promise => promise.then(value => log("fulfilled " + show(value))).catch(error => log("caught " + show(error))),
  rejected: promise => promise.catch(error => log("rejected " + show(error))).then(value => log("after " + show(value))),
  finally: promise => promise.finally(() => log("finally")).then(value => log("then " + show(value)), error => log("else " + show(error))),
  all: async promise => {
    try {
      log("all " + (await Promise.all([promise, 1, endsWith(2, 1)])).map(show));
    } catch (error) {
      log("all threw " + show(error));
    }
  },
  allOfMany: async promise => log("settled " + (await Promise.allSettled([promise, promise, endsWith(3, 2)])).map(one => one.status)),
  race: async promise => {
    try {
      log("race " + show(await Promise.race([promise, endsWith("late", 40)])));
    } catch (error) {
      log("race threw " + show(error));
    }
  },
  any: async promise => {
    try {
      log("any " + show(await Promise.any([promise, failsWith("other", 1)])));
    } catch (error) {
      log(error.constructor.name);
    }
  },
  await: async promise => {
    try {
      log("await " + show(await promise));
    } catch (error) {
      log("await threw " + show(error));
    }
  },
  twice: async promise => {
    const both = [waiters.await(promise), waiters.then(promise), waiters.await(promise)];
    await Promise.all(both);
  },
  resolved: promise => new Promise(resolve => resolve(promise)).then(value => log("resolved " + show(value)), error => log("not resolved " + show(error))),
  generator: async promise => {
    try {
      for await (const value of awaitsInGenerator(promise)) log("step " + show(value));
    } catch (error) {
      log("step threw " + show(error));
    }
  },
  returned: async promise => {
    const forwards = async () => promise;
    await waiters.then(forwards());
  },
  nobody: () => {},
  late: async promise => {
    await quiet(12);
    await waiters.then(promise);
  },
};

process.on("unhandledRejection", error => log("unhandled " + show(error)));
process.on("rejectionHandled", () => log("handled"));
for (const name of Object.keys(waiters)) {
  for (const waits of [0, 1, 3]) {
    for (const waiting of [0, 20]) {
      log(`-- ${name} ${waits} ${waiting}`);
      for (let k = 0; k < waiting; k++) void quiet(10);
      for (const value of ends) {
        const beside = ticks("t", 6);
        await waiters[name](endsWith(value, waits));
        await beside;
      }
      await storage.run("context", async () => {
        const promise = endsWith("value", waits);
        const inside = promise.then(() => log("inside " + storage.getStore()));
        await storage.run("other", () => promise.then(() => log("other " + storage.getStore())));
        await inside;
      });
      for (const value of ["error", new Error("thrown"), undefined]) {
        const beside = ticks("t", 6);
        await waiters[name](failsWith(value, waits));
        await beside;
      }
      await new Promise(resolve => setImmediate(resolve));
    }
  }
}
let sum = 0;
for (let round = 0; round < 20; round++) {
  const promises = [];
  for (let k = 0; k < 500; k++) promises.push(endsWith(k % 3 ? k : { k }, k % 4));
  const reactions = promises.map((promise, k) => (k % 2 ? promise.then(value => (typeof value === "number" ? value : value.k)) : promise));
  for (const value of await Promise.all(reactions)) sum += typeof value === "number" ? value : value.k;
}
log(sum);
console.log(out.join("\n"));
