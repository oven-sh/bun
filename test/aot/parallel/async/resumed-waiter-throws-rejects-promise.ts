// Eight async functions wait for one another over one pending promise, so each goes on as soon as the one below has returned. The second and the fifth throw right after their await. The error is
// that function's own: it rejects that function's promise and no other, the `catch` of its caller sees it, the functions below have returned their results and those above go on as usual.
// `unhandledRejection` names the promise that nobody handles, and the stack of the error lists the functions that wait, as in plain Bun. The same for other throwers, for values that are no
// errors, for a throw out of a callee, beside other jobs, inside a drain of the queue, for eight pairs side by side, and once more with an AsyncLocalStorage in use.
import { drainMicrotasks } from "bun:jsc";
import { AsyncLocalStorage } from "node:async_hooks";

Error.stackTraceLimit = 20;
const log: string[] = [];
const throwers = new Set<number>();
const throwersInCallee = new Set<number>();
const thrownValues = new Map<number, unknown>();
const namesOfPromises = new Map<Promise<unknown>, string>();
let visit: (id: number) => void = () => {};
let listsFrames = true;
let storage: AsyncLocalStorage<string> | undefined;

function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<number>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function turnOfTheEventLoop(): Promise<void> {
  return new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}
function countTurns(turns: number): void {
  let chain: Promise<void> = Promise.resolve();
  for (let turn = 1; turn <= turns; turn++) {
    chain = chain.then(() => {
      log.push("  turn " + turn);
    });
  }
}
function context(): string {
  return storage ? ", in " + storage.getStore() : "";
}
// The functions of this file on the stack, each with its line.
function framesOf(error: Error): string {
  const frames: string[] = [];
  for (const line of (error.stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):\d+\)?$/.exec(line);
    if (!frame || /^(native|node|bun|internal)\b/.test(frame[3])) continue;
    const name = frame[2] === undefined || frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2];
    frames.push((frame[1] ?? "") + name + ":" + frame[4]);
  }
  return frames.join(" < ");
}
function describe(reason: unknown): string {
  if (!(reason instanceof Error)) return typeof reason + " " + String(reason);
  return reason.name + " " + reason.message + (listsFrames ? " [" + framesOf(reason) + "]" : "");
}
function named<T>(name: string, promise: Promise<T>): Promise<T> {
  namesOfPromises.set(promise, name);
  return promise;
}
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  log.push("  unhandledRejection of " + (namesOfPromises.get(promise) ?? "a promise without a name") + ": " + describe(reason));
});

function goesOn(id: number, value: number): void {
  log.push("waiter " + id + " goes on with " + value + context());
  visit(id);
  if (throwersInCallee.has(id)) throw new TypeError("thrown below waiter " + id);
  if (thrownValues.has(id)) throw thrownValues.get(id);
}

async function innermost(gate: Promise<number>): Promise<number> {
  const value = await gate;
  log.push("the innermost function goes on with " + value + context());
  return value + 1;
}
async function waiter1(gate: Promise<number>): Promise<number> {
  const value = await innermost(gate);
  goesOn(1, value);
  if (throwers.has(1)) throw new RangeError("thrown by waiter 1");
  return value + 1;
}
async function waiter2(gate: Promise<number>): Promise<number> {
  const value = await waiter1(gate);
  goesOn(2, value);
  if (throwers.has(2)) throw new RangeError("thrown by waiter 2");
  return value + 1;
}
async function waiter3(gate: Promise<number>): Promise<number> {
  let value: number;
  try {
    value = await waiter2(gate);
  } catch (error) {
    log.push("waiter 3 caught " + describe(error));
    value = 300;
  }
  goesOn(3, value);
  if (throwers.has(3)) throw new RangeError("thrown by waiter 3");
  return value + 1;
}
async function waiter4(gate: Promise<number>): Promise<number> {
  const kept = { id: 4 }, text = "four";
  const value = await waiter3(gate);
  goesOn(kept.id, value);
  if (throwers.has(4)) throw new RangeError("thrown by waiter " + text);
  return value + 1;
}
async function waiter5(gate: Promise<number>): Promise<number> {
  const value = await waiter4(gate);
  goesOn(5, value);
  if (throwers.has(5)) throw new RangeError("thrown by waiter 5");
  return value + 1;
}
async function waiter6(gate: Promise<number>): Promise<number> {
  let value: number;
  try {
    value = await waiter5(gate);
  } catch (error) {
    log.push("waiter 6 caught " + describe(error));
    value = 600;
  }
  goesOn(6, value);
  if (throwers.has(6)) throw new RangeError("thrown by waiter 6");
  return value + 1;
}
async function waiter7(gate: Promise<number>): Promise<number> {
  try {
    const value = await waiter6(gate);
    goesOn(7, value);
    if (throwers.has(7)) throw new RangeError("thrown by waiter 7");
    return value + 1;
  } finally {
    log.push("waiter 7 cleans up");
  }
}
async function waiter8(gate: Promise<number>): Promise<number> {
  const value = await waiter7(gate);
  goesOn(8, value);
  if (throwers.has(8)) throw new RangeError("thrown by waiter 8");
  return value + 1;
}

// Eight pairs side by side: each outer function is the only waiter of its inner one.
async function inner(id: number, gate: Promise<number>): Promise<number> {
  return (await gate) + id;
}
async function outer(id: number, gate: Promise<number>): Promise<number> {
  const value = await inner(id, gate);
  goesOn(id, value);
  if (throwers.has(id)) throw new RangeError("thrown by waiter " + id);
  return value;
}

// Each function waits for the promise of the one before it, which the program holds too.
async function follows(id: number, before: Promise<number>): Promise<number> {
  const value = await before;
  goesOn(id, value);
  if (throwers.has(id)) throw new RangeError("thrown by waiter " + id);
  return value + 1;
}
async function followsAndCatches(id: number, before: Promise<number>): Promise<number> {
  let value: number;
  try {
    value = await before;
  } catch (error) {
    log.push("waiter " + id + " caught " + describe(error));
    value = id * 100;
  }
  goesOn(id, value);
  if (throwers.has(id)) throw new RangeError("thrown by waiter " + id);
  return value + 1;
}

function start<T>(action: () => T): T {
  return storage ? storage.run("the starter", action) : action();
}
function settleFromTheEventLoop(gate: { resolve: (value: number) => void }, value: number, afterwards: () => void = () => {}): void {
  setImmediate(() => {
    if (storage) storage.run("the resolver", () => gate.resolve(value));
    else gate.resolve(value);
    afterwards();
  });
}
async function outcomes(promises: Promise<number>[]): Promise<void> {
  const settled = await Promise.allSettled(promises);
  settled.forEach((outcome, i) => {
    const name = namesOfPromises.get(promises[i]);
    log.push("  " + name + (outcome.status === "fulfilled" ? " is fulfilled with " + outcome.value : " is rejected with " + describe(outcome.reason)));
  });
}
async function chainOfAwaits(afterwards?: () => void): Promise<void> {
  const gate = deferred();
  const result = start(() => waiter8(gate.promise));
  settleFromTheEventLoop(gate, 100, afterwards);
  try {
    log.push("result " + (await result));
  } catch (error) {
    log.push("the caller caught " + describe(error));
  }
}
function throwersAre(...ids: number[]): void {
  throwers.clear();
  for (const id of ids) throwers.add(id);
}

const scenarios: [title: string, body: () => Promise<void>][] = [
  ["nobody throws", () => chainOfAwaits()],
  [
    "the second and the fifth throw",
    () => {
      throwersAre(2, 5);
      return chainOfAwaits();
    },
  ],
  [
    "the second and the fifth throw beside a chain of reactions",
    () => {
      throwersAre(2, 5);
      return chainOfAwaits(() => countTurns(14));
    },
  ],
  [
    "every waiter queues a microtask, the second and the fifth throw",
    () => {
      throwersAre(2, 5);
      visit = id => queueMicrotask(() => log.push("  microtask of " + id));
      return chainOfAwaits();
    },
  ],
  [
    "the first throws, past the second",
    () => {
      throwersAre(1);
      return chainOfAwaits();
    },
  ],
  [
    "the fourth throws, past the fifth",
    () => {
      throwersAre(4);
      return chainOfAwaits();
    },
  ],
  [
    "the third and the sixth throw outside their try",
    () => {
      throwersAre(3, 6);
      return chainOfAwaits();
    },
  ],
  [
    "the seventh throws inside its try with a finally",
    () => {
      throwersAre(7);
      return chainOfAwaits();
    },
  ],
  [
    "the eighth throws",
    () => {
      throwersAre(8);
      return chainOfAwaits();
    },
  ],
  [
    "all of them throw",
    () => {
      throwersAre(1, 2, 3, 4, 5, 6, 7, 8);
      return chainOfAwaits();
    },
  ],
  [
    "the second throws a string, the fifth undefined, the eighth null",
    () => {
      thrownValues.set(2, "a string");
      thrownValues.set(5, undefined);
      thrownValues.set(8, null);
      return chainOfAwaits();
    },
  ],
  [
    "callees of the second and the fifth throw errors",
    () => {
      throwersInCallee.add(2);
      throwersInCallee.add(5);
      return chainOfAwaits();
    },
  ],
  [
    "the promise is rejected, and the fifth throws as well",
    async () => {
      throwersAre(5);
      listsFrames = false;
      const gate = deferred();
      const result = start(() => waiter8(gate.promise));
      setImmediate(() => gate.reject(new EvalError("the promise is rejected")));
      log.push("result " + (await result));
    },
  ],
  [
    "nobody handles the result when the seventh throws",
    async () => {
      throwersAre(7);
      const gate = deferred();
      named("the promise of waiter 8", start(() => waiter8(gate.promise)));
      settleFromTheEventLoop(gate, 100);
    },
  ],
  [
    "the result is handled a turn of the event loop after the eighth has thrown",
    async () => {
      throwersAre(8);
      const gate = deferred();
      const result = named("the promise of waiter 8", start(() => waiter8(gate.promise)));
      settleFromTheEventLoop(gate, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      await result.catch(error => log.push("caught late: " + describe(error)));
    },
  ],
  [
    "eight pairs side by side, the second and the fifth throw, nobody handles them",
    async () => {
      throwersAre(2, 5);
      const gate = deferred();
      const promises = [1, 2, 3, 4, 5, 6, 7, 8].map(id => named("the promise of waiter " + id, start(() => outer(id, gate.promise))));
      settleFromTheEventLoop(gate, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      await outcomes(promises);
    },
  ],
  [
    "eight pairs over eight promises, the second and the fifth throw, nobody handles them",
    async () => {
      throwersAre(2, 5);
      const gates = [1, 2, 3, 4, 5, 6, 7, 8].map(() => deferred());
      const promises = gates.map((gate, i) => named("the promise of waiter " + (i + 1), start(() => outer(i + 1, gate.promise))));
      for (const gate of gates) {
        settleFromTheEventLoop(gate, 100);
        await turnOfTheEventLoop();
      }
      await turnOfTheEventLoop();
      await outcomes(promises);
    },
  ],
  [
    "each waits for the promise of the one before, the second and the fifth throw, nobody catches",
    async () => {
      throwersAre(2, 5);
      const gate = deferred();
      const promises = [named("the promise of the innermost function", start(() => innermost(gate.promise)))];
      for (let id = 1; id <= 8; id++) promises.push(named("the promise of waiter " + id, start(() => follows(id, promises[id - 1]))));
      settleFromTheEventLoop(gate, 100);
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      await outcomes(promises);
    },
  ],
  [
    "each waits for the promise of the one before, the second and the fifth throw, the third and the sixth catch",
    async () => {
      throwersAre(2, 5);
      const gate = deferred();
      const promises = [named("the promise of the innermost function", start(() => innermost(gate.promise)))];
      for (let id = 1; id <= 8; id++) {
        const before = promises[id - 1];
        promises.push(named("the promise of waiter " + id, start(() => (id === 3 || id === 6 ? followsAndCatches(id, before) : follows(id, before)))));
      }
      settleFromTheEventLoop(gate, 100, () => countTurns(12));
      await turnOfTheEventLoop();
      await turnOfTheEventLoop();
      await outcomes(promises);
    },
  ],
  [
    "a chain whose second waiter throws runs inside the drain of a fourth waiter that throws next",
    async () => {
      throwersAre(2, 4);
      listsFrames = false;
      const outerGate = deferred(), innerGate = deferred();
      const nested = named("the promise of the chain inside", start(() => waiter8(innerGate.promise)));
      let drained = false;
      visit = id => {
        if (id !== 4 || drained) return;
        drained = true;
        innerGate.resolve(1000);
        drainMicrotasks();
        log.push("  waiter 4 has drained the queue");
      };
      const result = start(() => waiter8(outerGate.promise));
      settleFromTheEventLoop(outerGate, 100);
      log.push("result " + (await result));
      log.push("result of the chain inside " + (await nested));
    },
  ],
];

async function runAll(): Promise<void> {
  for (const [title, body] of scenarios) {
    log.push("-- " + title);
    throwers.clear();
    throwersInCallee.clear();
    thrownValues.clear();
    visit = () => {};
    listsFrames = true;
    await body();
    await turnOfTheEventLoop();
    await turnOfTheEventLoop();
  }
}

async function main(): Promise<void> {
  await runAll();
  log.push("-- once more with an AsyncLocalStorage in use");
  storage = new AsyncLocalStorage<string>();
  await runAll();
  console.log(log.join("\n"));
}
main();
