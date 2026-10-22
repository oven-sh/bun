// Eight async functions wait for one another and the innermost one waits for a promise. Once it is settled they go on from the inside out, a job each, and whatever else is queued keeps its place
// between them: then() reactions registered before and after the await, callbacks of queueMicrotask() and process.nextTick(), a second chain, a drain of the queue in the middle, results that are
// promises or thenables. The eight frames differ in size and each function finds its own values again. In the middle of one chain the program makes its first AsyncLocalStorage, then everything
// runs once more: every function goes on in the context in which it began to wait.
import { drainMicrotasks } from "bun:jsc";
import { AsyncLocalStorage } from "node:async_hooks";

const log: string[] = [];
let storage: AsyncLocalStorage<string> | undefined;
type Visit = (depth: number) => void;
const visitsNothing: Visit = () => {};

function deferred() {
  let resolve!: (value: number) => void;
  const promise = new Promise<number>(res => {
    resolve = res;
  });
  return { promise, resolve };
}
function turnOfTheEventLoop(): Promise<void> {
  return new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}
function inContext<T>(name: string, action: () => T): T {
  return storage ? storage.run(name, action) : action();
}
function context(): string {
  return storage ? ", in " + storage.getStore() : "";
}
// One line a turn of the job queue, so a turn that is lost or added shows.
function countTurns(turns: number): void {
  let chain: Promise<void> = Promise.resolve();
  for (let turn = 1; turn <= turns; turn++) {
    chain = chain.then(() => {
      log.push("  turn " + turn);
    });
  }
}

let serial = 0;
interface Pair {
  left: number;
  right: number;
}
function whole(): number {
  return ++serial;
}
function half(): number {
  return ++serial / 2;
}
function text(): string {
  return "s" + ++serial;
}
function pair(): Pair {
  const left = ++serial;
  return { left, right: left * 3 };
}
function worth(value: string | Pair): number {
  return typeof value === "string" ? Number(value.slice(1)) : value.left + value.right;
}
function goesOn(chain: string, depth: number, value: number, kept: number, visit: Visit): void {
  visit(depth);
  log.push(chain + depth + " goes on with " + value + ", keeps " + kept + context());
}

async function depth8(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const value = await gate;
  goesOn(chain, 8, value, 0, visit);
  return value + 1;
}
async function depth7(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole();
  const value = await depth8(chain, gate, visit);
  goesOn(chain, 7, value, a, visit);
  return value + 1;
}
async function depth6(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text();
  const value = await depth7(chain, gate, visit);
  goesOn(chain, 6, value, a + worth(b), visit);
  return value + 1;
}
async function depth5(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text(), c = pair();
  const value = await depth6(chain, gate, visit);
  goesOn(chain, 5, value, a + worth(b) + worth(c), visit);
  return value + 1;
}
async function depth4(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text(), c = pair(), d = half(), e = whole();
  const value = await depth5(chain, gate, visit);
  goesOn(chain, 4, value, a + worth(b) + worth(c) + d + e, visit);
  return value + 1;
}
async function depth3(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text(), c = pair(), d = half(), e = whole(), f = text(), g = pair(), h = half();
  const value = await depth4(chain, gate, visit);
  goesOn(chain, 3, value, a + worth(b) + worth(c) + d + e + worth(f) + worth(g) + h, visit);
  return value + 1;
}
async function depth2(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text(), c = pair(), d = half(), e = whole(), f = text(), g = pair(), h = half();
  const i = whole(), j = text(), k = pair(), l = half(), m = whole();
  const value = await depth3(chain, gate, visit);
  goesOn(chain, 2, value, a + worth(b) + worth(c) + d + e + worth(f) + worth(g) + h + i + worth(j) + worth(k) + l + m, visit);
  return value + 1;
}
async function depth1(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  const a = whole(), b = text(), c = pair(), d = half(), e = whole(), f = text(), g = pair(), h = half();
  const i = whole(), j = text(), k = pair(), l = half(), m = whole(), n = text(), o = pair(), p = half();
  const q = whole(), r = text(), s = pair(), t = half(), u = whole();
  const value = await depth2(chain, gate, visit);
  const kept = a + worth(b) + worth(c) + d + e + worth(f) + worth(g) + h + i + worth(j) + worth(k) + l + m + worth(n) + worth(o) + p + q + worth(r) + worth(s) + t + u;
  goesOn(chain, 1, value, kept, visit);
  return value + 1;
}

// Each function holds the promise of the one below, so others can wait for it as well.
type Watch = (depth: number, below: Promise<number>) => void;
async function keepsPromise(depth: number, gate: Promise<number>, watch: Watch): Promise<number> {
  const below = depth === 8 ? gate : keepsPromise(depth + 1, gate, watch);
  watch(depth, below);
  const value = await below;
  log.push("k" + depth + " goes on with " + value + context());
  return value + 1;
}

type Leave = (depth: number, value: number) => any;
async function leavesWith(depth: number, gate: Promise<number>, leave: Leave): Promise<number> {
  const value = depth === 8 ? await gate : await leavesWith(depth + 1, gate, leave);
  log.push("r" + depth + " goes on with " + value + context());
  return leave(depth, value + 1);
}

async function awaitsTwice(depth: number, first: Promise<number>, second: Promise<number>): Promise<number> {
  const value = depth === 8 ? await first : await awaitsTwice(depth + 1, first, second);
  log.push("t" + depth + " goes on with " + value + context());
  const more = await second;
  log.push("t" + depth + " goes on again with " + more + context());
  return value + more;
}

function startChain(chain: string, gate: Promise<number>, visit: Visit): Promise<number> {
  return inContext("the starter of " + chain, () => depth1(chain, gate, visit));
}
function settle(gate: { resolve: (value: number) => void }, value: number): void {
  inContext("the resolver", () => gate.resolve(value));
}
function settleFromTheEventLoop(gate: { resolve: (value: number) => void }, value: number): void {
  setImmediate(() => settle(gate, value));
}

const scenarios: [title: string, body: () => Promise<void>][] = [
  [
    "nothing else is queued",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result) + context());
    },
  ],
  [
    "a chain of reactions starts behind the resolution",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      setImmediate(() => {
        settle(gate, 100);
        countTurns(12);
      });
      log.push("result " + (await result));
    },
  ],
  [
    "a chain of reactions starts in front of the resolution",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      setImmediate(() => {
        countTurns(12);
        settle(gate, 100);
      });
      log.push("result " + (await result));
    },
  ],
  [
    "reactions registered before and after the await",
    async () => {
      const gate = deferred();
      gate.promise.then(value => log.push("  reaction registered before the await: " + value + context()));
      const result = startChain("a", gate.promise, visitsNothing);
      gate.promise.then(value => log.push("  reaction registered after the await: " + value + context()));
      result.then(value => log.push("  reaction to the result, registered before it is awaited: " + value));
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
      result.then(value => log.push("  reaction to the result, registered after it is settled: " + value));
    },
  ],
  [
    "every function queues a microtask",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, depth => queueMicrotask(() => log.push("  microtask of " + depth + context())));
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "every function calls process.nextTick",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, depth => process.nextTick(() => log.push("  next tick of " + depth + context())));
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "a microtask, a next tick, a reaction or nothing, by depth",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, depth => {
        if (depth % 4 === 0) queueMicrotask(() => log.push("  microtask of " + depth));
        else if (depth % 4 === 1) process.nextTick(() => log.push("  next tick of " + depth));
        else if (depth % 4 === 2) Promise.resolve(depth).then(value => log.push("  reaction of " + value));
      });
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "settled by a microtask between two others",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      queueMicrotask(() => log.push("  microtask in front"));
      queueMicrotask(() => settle(gate, 100));
      queueMicrotask(() => log.push("  microtask behind"));
      log.push("result " + (await result));
    },
  ],
  [
    "settled by a next tick between two others",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      process.nextTick(() => log.push("  next tick in front"));
      process.nextTick(() => settle(gate, 100));
      process.nextTick(() => log.push("  next tick behind"));
      log.push("result " + (await result));
    },
  ],
  [
    "settled by the function that awaits the result",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, visitsNothing);
      await null;
      settle(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "two chains over one promise",
    async () => {
      const gate = deferred();
      const results = [startChain("a", gate.promise, visitsNothing), startChain("b", gate.promise, visitsNothing)];
      settleFromTheEventLoop(gate, 100);
      log.push("results " + (await Promise.all(results)).join(" "));
    },
  ],
  [
    "two chains over two promises that are settled together",
    async () => {
      const first = deferred(), second = deferred();
      const results = [startChain("a", first.promise, visitsNothing), startChain("b", second.promise, visitsNothing)];
      setImmediate(() => {
        settle(second, 200);
        settle(first, 100);
      });
      log.push("results " + (await Promise.all(results)).join(" "));
    },
  ],
  [
    "the fourth function of one chain settles the promise of another",
    async () => {
      const first = deferred(), second = deferred();
      const other = startChain("b", second.promise, visitsNothing);
      const result = startChain("a", first.promise, depth => {
        if (depth === 4) settle(second, 200);
      });
      settleFromTheEventLoop(first, 100);
      log.push("results " + (await result) + " " + (await other));
    },
  ],
  [
    "the sixth and the second function drain the queue",
    async () => {
      const gate = deferred();
      const result = startChain("a", gate.promise, depth => {
        if (depth !== 6 && depth !== 2) return;
        queueMicrotask(() => log.push("  microtask of " + depth));
        drainMicrotasks();
        log.push("  " + depth + " has drained the queue");
      });
      setImmediate(() => {
        settle(gate, 100);
        countTurns(6);
      });
      log.push("result " + (await result));
    },
  ],
  [
    "a whole chain runs inside the drain of another chain's third function",
    async () => {
      const first = deferred(), second = deferred();
      const other = startChain("b", second.promise, visitsNothing);
      const result = startChain("a", first.promise, depth => {
        if (depth !== 3) return;
        settle(second, 200);
        drainMicrotasks();
        log.push("  3 has drained the queue");
      });
      settleFromTheEventLoop(first, 100);
      log.push("results " + (await result) + " " + (await other));
    },
  ],
  [
    "promises that only the function above waits for",
    async () => {
      const gate = deferred();
      const result = inContext("the starter", () => keepsPromise(1, gate.promise, () => {}));
      setImmediate(() => {
        settle(gate, 100);
        countTurns(10);
      });
      log.push("result " + (await result));
    },
  ],
  [
    "promises with a reaction registered before the await",
    async () => {
      const gate = deferred();
      const result = inContext("the starter", () =>
        keepsPromise(1, gate.promise, (depth, below) => {
          below.then(value => log.push("  reaction in front of k" + depth + ": " + value + context()));
        }),
      );
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "promises with a reaction registered after the await",
    async () => {
      const gate = deferred();
      const result = inContext("the starter", () =>
        keepsPromise(1, gate.promise, (depth, below) => {
          queueMicrotask(() => below.then(value => log.push("  reaction behind k" + depth + ": " + value + context())));
        }),
      );
      settleFromTheEventLoop(gate, 100);
      log.push("result " + (await result));
    },
  ],
  [
    "the sixth function returns a promise, the third a thenable",
    async () => {
      const gate = deferred();
      const result = inContext("the starter", () =>
        leavesWith(1, gate.promise, (depth, value) => {
          if (depth === 6) return Promise.resolve(value);
          if (depth !== 3) return value;
          return {
            then(resolve: (value: number) => void) {
              log.push("  then() of the thenable" + context());
              resolve(value);
            },
          };
        }),
      );
      setImmediate(() => {
        settle(gate, 100);
        countTurns(16);
      });
      log.push("result " + (await result));
    },
  ],
  [
    "the fifth function returns a promise that is settled later",
    async () => {
      const gate = deferred(), late = deferred();
      const result = inContext("the starter", () => leavesWith(1, gate.promise, (depth, value) => (depth === 5 ? late.promise : value)));
      settleFromTheEventLoop(gate, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      log.push("  the late promise is settled");
      settleFromTheEventLoop(late, 500);
      log.push("result " + (await result));
    },
  ],
  [
    "every function awaits a second promise before it returns",
    async () => {
      const first = deferred(), second = deferred();
      const result = inContext("the starter", () => awaitsTwice(1, first.promise, second.promise));
      settleFromTheEventLoop(first, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      log.push("  the second promise is settled");
      settleFromTheEventLoop(second, 1);
      log.push("result " + (await result));
    },
  ],
  [
    "every function awaits a second promise before it returns, beside a chain of reactions",
    async () => {
      const first = deferred(), second = deferred();
      const result = inContext("the starter", () => awaitsTwice(1, first.promise, second.promise));
      settleFromTheEventLoop(first, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      setImmediate(() => {
        settle(second, 1);
        countTurns(20);
      });
      log.push("result " + (await result));
    },
  ],
];

async function runAll(): Promise<void> {
  for (const [title, body] of scenarios) {
    log.push("-- " + title);
    await body();
    await turnOfTheEventLoop();
    await turnOfTheEventLoop();
  }
}

await runAll();

log.push("-- the fifth function makes the first AsyncLocalStorage");
{
  const gate = deferred();
  const result = depth1("a", gate.promise, depth => {
    if (depth !== 5) return;
    storage = new AsyncLocalStorage<string>();
    storage.enterWith("what the fifth function entered");
  });
  setImmediate(() => gate.resolve(100));
  log.push("result " + (await result) + context());
  await turnOfTheEventLoop();
}
log.push("-- the fourth function enters another context");
{
  const gate = deferred();
  const result = startChain("a", gate.promise, depth => {
    if (depth === 4) storage!.enterWith("what the fourth function entered");
  });
  settleFromTheEventLoop(gate, 100);
  log.push("result " + (await result) + context());
  await turnOfTheEventLoop();
}

await runAll();
console.log(log.join("\n"));
