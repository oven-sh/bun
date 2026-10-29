// An await of a number, a boolean, null, undefined or any other primitive, in a function that has to suspend because other jobs are queued, queues the job that resumes the function, and so does
// an await of a call that has finished. Those jobs take their turn among the jobs of then() handlers and of other awaits: while the queue wraps around the end of its storage, while it grows
// from one job to eight thousand, and while the collector runs with nothing but a queued job holding on to a suspended function.
// The program counts the entries of the operations that such an await leaves for, which only the jsc shell can.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
declare const gc: undefined | (() => void);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
function entered(): number {
  return counted ? counted("operationAOTAwaitWithSavedFrame") + counted("operationAOTAwaitCallWithSavedFrame") : 0;
}
function few(entries: number, awaits: number): string {
  return entries * 20 < awaits ? "few entries" : entries + " ENTRIES FOR " + awaits + " AWAITS";
}
const settled = Promise.resolve();
const lines: string[] = [];
let log: string[] = [];

function show(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (typeof value === "bigint") return value + "n";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

async function awaitsIntegers(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await i));
}
async function awaitsFractions(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await (i / 4)));
}
async function awaitsBooleans(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await (i % 2 === 0)));
}
async function awaitsNull(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await null));
}
async function awaitsUndefined(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await undefined));
}
async function awaitsStrings(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await ("s" + i)));
}
async function awaitsBigInts(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await BigInt(i)));
}
async function awaitsSymbols(label: string, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await Symbol.iterator));
}
async function awaitsWhatComes(label: string, values: unknown[]): Promise<void> {
  for (const value of values) log.push(label + " " + show(await value));
}
async function awaitsItsNumber(n: number): Promise<number> {
  return await n;
}
function thenChain(label: string, steps: number): void {
  let done = 0;
  const step = (): void => {
    log.push(label + " " + done);
    if (++done < steps) settled.then(step);
  };
  settled.then(step);
}
function chainOfNewPromises(label: string, steps: number): void {
  let done = 0;
  const step = (): void => {
    log.push(label + " " + done);
    if (++done < steps) Promise.resolve(done).then(step);
  };
  Promise.resolve(done).then(step);
}

async function everyKindTogether(): Promise<void> {
  log = [];
  const all = [
    awaitsIntegers("integers", 4),
    awaitsFractions("fractions", 3),
    awaitsBooleans("booleans", 4),
  ];
  thenChain("then", 5);
  all.push(awaitsNull("null", 3), awaitsUndefined("undefined", 4), awaitsStrings("strings", 3));
  chainOfNewPromises("new promise", 5);
  all.push(awaitsBigInts("bigints", 3), awaitsSymbols("symbols", 2), awaitsWhatComes("what comes", [1, "two", null, 3.5, undefined, false, 4n, Symbol.for("five"), -0, NaN]));
  log.push("all have begun");
  await Promise.all(all);
  lines.push("== every kind together", ...log);
}

async function numbersComeBack(): Promise<void> {
  const numbers = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 2147483647, -2147483648, 2147483648, 4294967295, 9007199254740991, 5e-324, 1.7976931348623157e308];
  log = [];
  thenChain("then", 3);
  const results = await Promise.all(numbers.map(awaitsItsNumber));
  lines.push("== numbers come back", results.map(show).join(" "));
}

type Lap = (id: number, steps: number, seen: number[]) => Promise<void>;
async function mayWait(n: number, waits: boolean): Promise<number> {
  if (waits) await settled;
  return n;
}
async function neverWaits(n: number): Promise<number> {
  return n + 1;
}
const lapOfIntegers: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await step) === step) seen.push(id);
  }
};
const lapOfFractions: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await (step / 8)) * 8 === step) seen.push(id);
  }
};
const lapOfNothing: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await undefined) === undefined) seen.push(id);
  }
};
const lapOfBooleans: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await (step >= 0)) === true) seen.push(id);
  }
};
const lapOfStrings: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await ("lap " + step)).length > 4) seen.push(id);
  }
};
const lapOfFinishedCalls: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await mayWait(step, false)) === step) seen.push(id);
  }
};
const lapOfCallsThatNeverWait: Lap = async (id, steps, seen) => {
  for (let step = 0; step < steps; step++) {
    if ((await neverWaits(step)) === step + 1) seen.push(id);
  }
};

// Every member takes one turn a step, so the members go on in the order in which they began, step after step.
async function population(label: string, lap: Lap, size: number, steps: number, countsEntries: boolean): Promise<void> {
  const seen: number[] = [];
  const all: Promise<void>[] = [];
  const before = entered();
  for (let id = 0; id < size; id++) all.push(lap(id, steps, seen));
  let thens = 0;
  const byThen = (): void => {
    seen.push(size);
    if (++thens < steps) settled.then(byThen);
  };
  settled.then(byThen);
  let newPromises = 0;
  const byNewPromise = (): void => {
    seen.push(size + 1);
    if (++newPromises < steps) Promise.resolve(newPromises).then(byNewPromise);
  };
  Promise.resolve(newPromises).then(byNewPromise);
  await Promise.all(all);
  const entries = entered() - before;
  const members = size + 2;
  const inTurn = seen.length === members * steps && seen.every((id, index) => id === index % members);
  lines.push(label + ", " + size + " functions, " + steps + " steps: " + (inTurn ? "each in its turn" : "OUT OF TURN: " + seen.slice(0, 3 * members).join(" ")) + (countsEntries ? ", " + few(entries, size * steps) : ""));
}

let order: number[] = [];
async function spawns(depth: number, id: number): Promise<number> {
  await id;
  order.push(id);
  if (!depth) return 1;
  const left = spawns(depth - 1, 2 * id);
  const right = spawns(depth - 1, 2 * id + 1);
  return (await left) + (await right);
}
async function growth(depth: number): Promise<void> {
  order = [];
  const before = entered();
  const leaves = await spawns(depth, 1);
  const entries = entered() - before;
  const inOrder = order.every((id, index) => id === index + 1);
  lines.push("a tree of depth " + depth + ": " + leaves + " leaves, " + order.length + " functions, " + (inOrder ? "level by level" : "OUT OF ORDER: " + order.slice(0, 40).join(" ")) + (order.length > 1000 ? ", " + few(entries, order.length) : ""));
}

interface Held {
  id: number;
  text: string;
}
async function holds(id: number, steps: number): Promise<number> {
  const held: Held = { id, text: "held " + id };
  let sum = 0;
  for (let step = 0; step < steps; step++) sum += (await step) + held.id + held.text.length;
  return sum;
}
async function collections(size: number, steps: number): Promise<void> {
  const all: Promise<number>[] = [];
  for (let id = 0; id < size; id++) {
    all.push(holds(id, steps));
    if (id === size >> 1) {
      let rounds = 0;
      const collects = (): void => {
        collect();
        if (++rounds < steps) settled.then(collects);
      };
      settled.then(collects);
    }
  }
  const sums = await Promise.all(all);
  lines.push(size + " functions that only queued jobs hold, with a collection in every round: " + sums.reduce((a, b) => a + b, 0));
}

await everyKindTogether();
await numbersComeBack();
lines.push("== in turn");
for (const size of [1, 2, 3, 6, 7, 13, 14, 15, 29, 30, 31, 61, 62, 63, 100, 1000]) await population("integers", lapOfIntegers, size, 40, false);
await population("integers", lapOfIntegers, 10, 3000, true);
await population("fractions", lapOfFractions, 10, 3000, true);
await population("undefined", lapOfNothing, 10, 3000, true);
await population("booleans", lapOfBooleans, 10, 3000, true);
await population("strings", lapOfStrings, 10, 3000, false);
await population("calls that have finished", lapOfFinishedCalls, 10, 3000, true);
await population("calls of a function that never awaits", lapOfCallsThatNeverWait, 10, 3000, true);
await population("integers", lapOfIntegers, 5000, 6, true);
lines.push("== growth");
for (const depth of [0, 1, 2, 3, 4, 5, 8, 13]) await growth(depth);
await growth(13);
lines.push("== collections");
await collections(2000, 4);
console.log(lines.join("\n"));

export {};
