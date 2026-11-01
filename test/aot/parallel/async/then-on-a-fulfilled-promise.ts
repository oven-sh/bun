// then() on a promise that is already fulfilled queues its handler behind the jobs that are already waiting, with the value, under the async context of the call.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];

async function keepsTheOrderOfJobs() {
  const events: string[] = [];
  const fulfilled = Promise.resolve("value");
  const { promise: pending, resolve } = Promise.withResolvers<string>();
  queueMicrotask(() => events.push("microtask 1"));
  fulfilled.then(value => events.push(`first ${value}`));
  pending.then(value => events.push(`pending ${value}`));
  queueMicrotask(() => events.push("microtask 2"));
  fulfilled.then(value => events.push(`second ${value}`));
  resolve("late");
  fulfilled.then(value => events.push(`third ${value}`));
  events.push("synchronous");
  await new Promise<void>(done => setTimeout(done, 0));
  lines.push(events.join(", "));
}

// Every kind of job at once, round after round: the first rounds run code that has not run before, the later ones code that has.
async function interleavesWithEveryKindOfJob(rounds: number) {
  const seen = new Map<string, number>();
  for (let round = 0; round < rounds; round++) {
    const events: string[] = [];
    const fulfilled = Promise.resolve(round);
    const { promise: pending, resolve } = Promise.withResolvers<number>();
    const thenable = {
      then(done: (value: number) => void) {
        events.push("then of the thenable");
        done(round);
      },
    } as unknown as PromiseLike<number>;
    process.nextTick(() => events.push("tick 1"));
    fulfilled.then(() => events.push("fulfilled 1"));
    pending.then(() => events.push("pending 1"));
    (async () => {
      events.push("async function starts");
      await fulfilled;
      events.push("after await fulfilled");
      await pending;
      events.push("after await pending");
      await thenable;
      events.push("after await thenable");
      await 0;
      events.push("after await 0");
    })();
    queueMicrotask(() => {
      events.push("microtask 1");
      fulfilled.then(() => events.push("fulfilled from a microtask"));
      process.nextTick(() => events.push("tick from a microtask"));
    });
    Promise.resolve(thenable).then(() => events.push("resolved with the thenable"));
    fulfilled.then(() => {
      events.push("fulfilled 2");
      resolve(round);
      fulfilled.then(() => events.push("fulfilled from a handler"));
    });
    fulfilled.then(() => thenable).then(() => events.push("a handler returned the thenable"));
    fulfilled.then(() => fulfilled).then(() => events.push("a handler returned the promise"));
    pending.then(() => fulfilled.then(() => events.push("fulfilled from a handler of pending")));
    process.nextTick(() => {
      events.push("tick 2");
      fulfilled.then(() => events.push("fulfilled from a tick"));
    });
    queueMicrotask(() => events.push("microtask 2"));
    fulfilled.then(() => events.push("fulfilled 3"));
    events.push("synchronous");
    await new Promise<void>(done => setImmediate(done));
    const line = events.join(", ");
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  for (const [line, count] of seen) lines.push(`${count} times: ${line}`);
}

async function passesEveryKindOfValue() {
  const point = { x: 1, y: 2 };
  const seen: string[] = [];
  await Promise.resolve(7).then(value => seen.push(`${typeof value} ${value + 1}`));
  await Promise.resolve(1.5).then(value => seen.push(`${typeof value} ${value * 2}`));
  await Promise.resolve("text").then(value => seen.push(`${typeof value} ${value.length}`));
  await Promise.resolve(undefined).then(value => seen.push(`${typeof value}`));
  await Promise.resolve(null).then(value => seen.push(`${value}`));
  await Promise.resolve(point).then(value => seen.push(`${value === point} ${value.x + value.y}`));
  await Promise.resolve([1, 2, 3]).then(value => seen.push(`${value.length}`));
  lines.push(seen.join(", "));
}

async function settlesTheDerivedPromise() {
  const results: string[] = [];
  results.push(`returned ${await Promise.resolve(1).then(value => value + 1)}`);
  results.push(`adopted ${await Promise.resolve(1).then(value => Promise.resolve(value + 2))}`);
  const thenable = (result: number) => ({ then: (done: (value: number) => void) => done(result) }) as unknown as PromiseLike<number>;
  results.push(`thenable ${await Promise.resolve(1).then(value => thenable(value + 3))}`);
  try {
    await Promise.resolve(1).then(value => {
      throw new RangeError(`thrown ${value}`);
    });
  } catch (error) {
    results.push(`${(error as Error).name} ${(error as Error).message}`);
  }
  let called = false;
  try {
    await Promise.reject(new TypeError("rejected")).then(() => {
      called = true;
    });
  } catch (error) {
    results.push(`${(error as Error).message}, handler called: ${called}`);
  }
  lines.push(results.join(", "));
}

async function callsEveryKindOfFunction() {
  const results: string[] = [];
  const first = Promise.withResolvers<number>();
  Promise.resolve(10).then(first.resolve);
  results.push(`resolving function ${await first.promise}`);
  const second = Promise.withResolvers<number>();
  Promise.resolve(11).then(second.reject);
  results.push(`rejecting function ${await second.promise.catch(reason => reason)}`);
  const counter = {
    total: 5,
    add(value: number) {
      return (this.total += value);
    },
  };
  results.push(`bound function ${await Promise.resolve(12).then(counter.add.bind(counter))}`);
  results.push(`built-in ${await Promise.resolve(-13).then(Math.abs)}`);
  results.push(`async function ${await Promise.resolve(14).then(async value => value + 1)}`);
  lines.push(results.join(", "));
}

// More jobs than the queue has room for at first.
async function queuesManyHandlersAtOnce() {
  const fulfilled = Promise.resolve(1);
  const order: number[] = [];
  let sum = 0;
  for (let i = 0; i < 20000; i++) {
    fulfilled.then(value => {
      sum += value;
      if (i % 4000 === 0) order.push(i);
    });
  }
  await fulfilled;
  lines.push(`${sum} ${order.join(" ")}`);
}

async function queuesFromInsideHandlers() {
  let depth = 0;
  const { promise, resolve } = Promise.withResolvers<number>();
  const next = (value: number) => {
    if (++depth < 5000) Promise.resolve(value + 1).then(next);
    else resolve(value);
  };
  Promise.resolve(0).then(next);
  lines.push(`${await promise} ${depth}`);
}

async function keepsValuesAliveAcrossCollections() {
  let sum = 0;
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 200; i++) Promise.resolve({ index: i, name: `item ${i}` }).then(item => (sum += item.index + item.name.length));
    Bun.gc(true);
    await undefined;
  }
  await new Promise<void>(done => setTimeout(done, 0));
  lines.push(`${sum}`);
}

async function runsUnderTheContextOfTheCall() {
  const storage = new AsyncLocalStorage<string>();
  const fulfilled = Promise.resolve("value");
  const seen: string[] = [];
  fulfilled.then(() => seen.push(`outside ${storage.getStore()}`));
  storage.run("a", () => fulfilled.then(() => seen.push(`in a ${storage.getStore()}`)));
  storage.run("b", () => {
    fulfilled.then(() => seen.push(`in b ${storage.getStore()}`));
    storage.run("c", () => fulfilled.then(() => seen.push(`in c ${storage.getStore()}`)));
  });
  fulfilled.then(() => seen.push(`outside again ${storage.getStore()}`));
  await new Promise<void>(done => setTimeout(done, 0));
  lines.push(seen.join(", "));
}

await keepsTheOrderOfJobs();
await interleavesWithEveryKindOfJob(300);
await passesEveryKindOfValue();
await settlesTheDerivedPromise();
await callsEveryKindOfFunction();
await queuesManyHandlersAtOnce();
await queuesFromInsideHandlers();
await keepsValuesAliveAcrossCollections();
await runsUnderTheContextOfTheCall();
await keepsTheOrderOfJobs();
await interleavesWithEveryKindOfJob(3);
console.log(lines.join("\n"));
