// A chain of 20,000 async functions, each waiting for the next, unwinds innermost first once a timer settles the last one, and the stack does not grow with it. The end of a function hands its
// result to the one function that waits for it, whether that one awaited the call or a variable that holds the call's promise, with an empty job queue and beside other jobs. A job that a
// function queues before it ends still runs before its waiter, and a promise with several waiters serves them in the order in which they came.
// The program counts the entries of the operation that the end of an async function leaves for, which only the jsc shell can.
// STATISTIC: AwaitedCallsResolved >= 4
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entered(): number {
  return counted ? counted("operationAOTResolvePromiseOrReturnResult") : 0;
}
const chainLength = 20_000;
const settled = Promise.resolve();
const lines: string[] = [];
type Ending = "a number" | "a thenable" | "a promise" | "an error";

interface Ticker {
  count: number;
  isOn: boolean;
}
let ticker: Ticker | null = null;
function startTicker(): void {
  const own: Ticker = { count: 0, isOn: true };
  const step = (): void => {
    if (!own.isOn) return;
    own.count++;
    settled.then(step);
  };
  ticker = own;
  settled.then(step);
}
function stopTicker(): void {
  if (ticker) ticker.isOn = false;
  ticker = null;
}
function now(): string {
  return ticker ? " at tick " + ticker.count : "";
}

let resumed: number[] = [];
let marks: string[] = [];
let markEvery = 5_000;
let hasOtherJobs = false;

function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => {
      if (hasOtherJobs) startTicker();
      resolve();
    }, 0);
  });
}
function thenable(value: number): PromiseLike<number> {
  return {
    then(resolve: any): any {
      resolve(value);
    },
  };
}
function didResume(depth: number): void {
  resumed.push(depth);
  if (depth % markEvery === 0) marks.push(depth + now());
  if (depth % markEvery === 1) settled.then(() => marks.push("the job of " + depth + " after " + resumed.length + now()));
}
function describe(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

async function innermost(ending: Ending): Promise<number> {
  await afterTimer();
  switch (ending) {
    case "an error":
      throw new RangeError("thrown by the innermost function");
    case "a thenable":
      return thenable(0);
    case "a promise":
      return settled.then(() => 0);
    default:
      return 0;
  }
}
async function awaitsCall(depth: number, ending: Ending): Promise<number> {
  await settled;
  try {
    return 1 + (depth ? await awaitsCall(depth - 1, ending) : await innermost(ending));
  } finally {
    didResume(depth);
  }
}
async function awaitsVariable(depth: number, ending: Ending): Promise<number> {
  await settled;
  const pending = depth ? awaitsVariable(depth - 1, ending) : innermost(ending);
  try {
    return 1 + (await pending);
  } finally {
    didResume(depth);
  }
}
async function awaitsCallWithoutHandler(depth: number, ending: Ending): Promise<number> {
  await settled;
  const below = depth ? await awaitsCallWithoutHandler(depth - 1, ending) : await innermost(ending);
  didResume(depth);
  return below + 1;
}
async function awaitsVariableWithoutHandler(depth: number, ending: Ending): Promise<number> {
  await settled;
  const pending = depth ? awaitsVariableWithoutHandler(depth - 1, ending) : innermost(ending);
  const below = await pending;
  didResume(depth);
  return below + 1;
}
// No function of this chain has been suspended before it waits for the next one.
async function descendsOnTheStack(depth: number, ending: Ending): Promise<number> {
  const below = depth ? await descendsOnTheStack(depth - 1, ending) : await innermost(ending);
  didResume(depth);
  return below + 1;
}

interface Parcel {
  label: string;
  weight: number;
}
async function packs(): Promise<Parcel> {
  await afterTimer();
  return { label: "parcel", weight: 3 };
}
async function carriesAParcel(depth: number): Promise<Parcel> {
  await settled;
  const parcel = depth ? await carriesAParcel(depth - 1) : await packs();
  didResume(depth);
  return parcel;
}
async function writes(): Promise<string> {
  await afterTimer();
  return "text";
}
async function carriesText(depth: number): Promise<string> {
  await settled;
  const text = depth ? await carriesText(depth - 1) : await writes();
  didResume(depth);
  return depth % markEvery === 0 ? text + "!" : text;
}
async function finishes(): Promise<void> {
  await afterTimer();
}
async function carriesNothing(depth: number): Promise<void> {
  await settled;
  if (depth) await carriesNothing(depth - 1);
  else await finishes();
  didResume(depth);
}

async function run(label: string, length: number, start: (depth: number) => Promise<unknown>, withOtherJobs: boolean): Promise<void> {
  resumed = [];
  marks = [];
  markEvery = length / 4;
  hasOtherJobs = withOtherJobs;
  const before = entered();
  let outcome: string;
  try {
    outcome = "fulfilled with " + describe(await start(length - 1));
  } catch (error) {
    outcome = "rejected with " + (error as Error).message;
  }
  stopTicker();
  const entries = entered() - before;
  const isInnermostFirst = resumed.every((depth, index) => depth === index);
  lines.push(label + (withOtherJobs ? ", other jobs queued: " : ", empty queue: ") + outcome + ", " + resumed.length + " went on, innermost first: " + isInnermostFirst + ", " + (entries * 20 < length ? "few entries" : entries + " ENTRIES FOR " + length + " FUNCTIONS"));
  lines.push("  " + marks.join(", "));
}

function afterAllJobs(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
let kept: Promise<number>[] = [];
let log: string[] = [];
async function waitsFor(gate: Promise<number>): Promise<number> {
  const value = await gate;
  log.push("the innermost function goes on" + now());
  return value;
}
async function keepsItsPromise(depth: number, gate: Promise<number>): Promise<number> {
  await settled;
  const pending = depth ? keepsItsPromise(depth - 1, gate) : waitsFor(gate);
  kept[depth] = pending;
  if (depth === 1) pending.then(value => log.push("a then from before the await of 1 gets " + value + now()));
  const value = await pending;
  log.push(depth + " goes on with " + value + now());
  return value + 1;
}
async function alsoAwaits(label: string, promise: Promise<number>): Promise<void> {
  const value = await promise;
  log.push(label + " gets " + value + now());
}
async function severalWaiters(withOtherJobs: boolean): Promise<void> {
  kept = [];
  log = [];
  let open!: (value: number) => void;
  const gate = new Promise<number>(resolve => {
    open = resolve;
  });
  const whole = keepsItsPromise(8, gate);
  await afterAllJobs();
  kept[2].then(value => log.push("a then from after the await of 2 gets " + value + now()));
  void alsoAwaits("a second function at 3", kept[3]);
  void alsoAwaits("a second function at 4", kept[4]);
  void alsoAwaits("a third function at 4", kept[4]);
  kept[5].finally(() => log.push("a finally at 5" + now()));
  void Promise.all([kept[6], kept[0]]).then(values => log.push("all of 6 and 0 gets " + values.join(" and ") + now()));
  void Promise.race([kept[7]]).then(value => log.push("a race at 7 gets " + value + now()));
  if (withOtherJobs) startTicker();
  open(100);
  log.push("the gate is open");
  log.push("the whole chain gives " + (await whole) + now());
  await settled;
  await settled;
  await settled;
  stopTicker();
  lines.push(withOtherJobs ? "several waiters, other jobs queued:" : "several waiters, empty queue:");
  for (const line of log) lines.push("  " + line);
}

const chains: [label: string, chain: (depth: number, ending: Ending) => Promise<number>, endings: Ending[]][] = [
  ["awaits the call", awaitsCall, ["a number", "a thenable", "a promise", "an error"]],
  ["awaits a variable", awaitsVariable, ["a number", "a thenable", "a promise", "an error"]],
  ["awaits the call, no handler", awaitsCallWithoutHandler, ["a number", "an error"]],
  ["awaits a variable, no handler", awaitsVariableWithoutHandler, ["a number", "an error"]],
];
for (const [label, chain, endings] of chains) {
  for (const ending of endings) {
    for (const withOtherJobs of [false, true]) await run(label + ", " + ending, chainLength, depth => chain(depth, ending), withOtherJobs);
  }
}
for (const withOtherJobs of [false, true]) {
  await run("carries a record", chainLength, carriesAParcel, withOtherJobs);
  await run("carries a string", chainLength, carriesText, withOtherJobs);
  await run("carries nothing", chainLength, carriesNothing, withOtherJobs);
  for (const ending of ["a number", "a thenable", "an error"] as const) await run("descends on the stack, " + ending, 1_000, depth => descendsOnTheStack(depth, ending), withOtherJobs);
  await severalWaiters(withOtherJobs);
}
console.log(lines.join("\n"));

export {};
