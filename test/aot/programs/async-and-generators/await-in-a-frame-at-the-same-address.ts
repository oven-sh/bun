// A coroutine that a job has entered while nothing else is queued need not wait at an await of a settled value. That right belongs to one frame and ends with it. Here such a frame ends: it returns,
// throws, waits, hands its result to the function that waits for it, drains the queue. Then code that is no such coroutine (a timer callback, a then handler, code behind a drain of the queue) calls
// an async function, again with nothing queued. The frame of that call may lie at the very address of the frame that ended, so every call is made below 0 to 96 frames of one size and, between them
// and the call, one frame of four other sizes or none. Wherever the new frame lies, its first await suspends: the caller goes on before the code behind the await.
declare const drainMicrotasks: undefined | (() => void);
const drain: () => void = typeof drainMicrotasks === "function" ? drainMicrotasks : require("bun:jsc").drainMicrotasks;
type Action = () => void;
const afterTimer = (action: Action): void => {
  setTimeout(action, 0);
};
const soon: (action: Action) => void =
  typeof setImmediate === "function"
    ? action => {
        setImmediate(action);
      }
    : afterTimer;
const settled = Promise.resolve();
const fulfilled = Promise.resolve(7);
const lines: string[] = [];
let log: string[] | null = null;
let isCalling = false;
let arrivals = 0;
let early = 0;
let sink = 0;
let seedA = 1, seedB = 2, seedC = 3, seedD = 4, seedE = 5, seedF = 6, seedG = 7, seedH = 8;

function ignore(): void {}
// Runs behind the first await of every function that is called here.
function arrived(): void {
  arrivals++;
  seedA += 1; seedB += 2; seedC += 3; seedD += 4; seedE += 5; seedF += 6; seedG += 7; seedH += 8;
  if (isCalling) early++;
  if (log) log.push(isCalling ? "BEHIND THE AWAIT, BEFORE THE CALLER WENT ON" : "behind the await");
}
function afterJobs(count: number, action: Action): void {
  settled.then(count > 1 ? () => afterJobs(count - 1, action) : action);
}
// A chain of jobs that starts when the caller has gone on: a turn that is lost or added shows in the order of the log.
function beat(into: string[], beats: number): void {
  let done = 0;
  const step = (): void => {
    into.push("tick " + ++done);
    if (done < beats) settled.then(step);
  };
  settled.then(step);
}

// Frames of several sizes: each function keeps more values across its call than the one before, and the call could change the variables that they were read from.
function keepsTwo(levels: number, action: Action): number {
  const a = seedA, b = seedB;
  if (levels) keepsTwo(levels - 1, action);
  else action();
  return a - b;
}
function keepsFour(levels: number, action: Action): number {
  const a = seedA, b = seedB, c = seedC, d = seedD;
  if (levels) keepsFour(levels - 1, action);
  else action();
  return a - b + c - d;
}
function keepsSix(levels: number, action: Action): number {
  const a = seedA, b = seedB, c = seedC, d = seedD, e = seedE, f = seedF;
  if (levels) keepsSix(levels - 1, action);
  else action();
  return a - b + c - d + e - f;
}
function keepsEight(levels: number, action: Action): number {
  const a = seedA, b = seedB, c = seedC, d = seedD, e = seedE, f = seedF, g = seedG, h = seedH;
  if (levels) keepsEight(levels - 1, action);
  else action();
  return a - b + c - d + e - f + g - h;
}
function below(levels: number, extra: number, action: Action): number {
  if (levels) return below(levels - 1, extra, action) + levels;
  switch (extra) {
    case 1:
      return keepsTwo(0, action) + 1;
    case 2:
      return keepsFour(0, action) + 1;
    case 3:
      return keepsSix(0, action) + 1;
    case 4:
      return keepsEight(0, action) + 1;
    default:
      action();
      return 0;
  }
}
const paddings: [levels: number, extra: number][] = [];
for (let levels = 0; levels <= 96; levels++) for (let extra = 0; extra < 5; extra++) paddings.push([levels, extra]);

// The functions that are called. None of them has been suspended before its first await.
async function quick(n: number): Promise<number> {
  return n + 1;
}
async function waitsOnce(n: number): Promise<number> {
  await settled;
  arrived();
  return n + 1;
}
async function* counts(count: number): AsyncGenerator<number, void, unknown> {
  for (let i = 1; i <= count; i++) yield i;
}
async function awaitsANumber(): Promise<void> {
  await 1;
  arrived();
}
async function awaitsAFulfilledPromise(): Promise<void> {
  const value = await fulfilled;
  sink += value;
  arrived();
}
async function awaitsAFinishedCall(): Promise<void> {
  const value = await quick(1);
  sink += value;
  arrived();
}
async function awaitsACallThatWaits(): Promise<void> {
  const value = await waitsOnce(1);
  sink += value;
  arrived();
}
async function stepsAStream(): Promise<void> {
  for await (const value of counts(1)) {
    sink += value;
    arrived();
  }
}
async function loopsOverAnArray(): Promise<void> {
  for await (const value of [1]) {
    sink += value;
    arrived();
  }
}
async function awaitsInATry(): Promise<void> {
  try {
    await null;
  } finally {
    arrived();
  }
}
const arrow = async (): Promise<void> => {
  await undefined;
  arrived();
};
class Holder {
  constructor(readonly base: number) {}
  async awaits(): Promise<void> {
    const value = await 2;
    sink += this.base + value;
    arrived();
  }
}
const holder = new Holder(1);
async function* awaitsInItsBody(): AsyncGenerator<number, void, unknown> {
  const value = await 1;
  sink += value;
  arrived();
  yield value;
}
const kinds: [kind: string, call: () => unknown, isSwept: boolean][] = [
  ["awaits a number", awaitsANumber, true],
  ["awaits a fulfilled promise", awaitsAFulfilledPromise, true],
  ["awaits a call that has finished", awaitsAFinishedCall, true],
  ["awaits a call that waits", awaitsACallThatWaits, false],
  ["steps a stream", stepsAStream, true],
  ["loops over an array with for await", loopsOverAnArray, false],
  ["awaits in a try", awaitsInATry, false],
  ["is an arrow function", arrow, false],
  ["is a method", () => holder.awaits(), false],
  ["is the body of a stream, asked by next()", () => awaitsInItsBody().next(), true],
];

// The frames that a job enters and that end before the call.
const endings = [
  "returns",
  "throws",
  "waits for a promise that stays pending",
  "goes on in place and returns",
  "drains the queue and returns",
  "returns to the function that awaited its call",
  "throws to the function that awaited its call",
  "returns to a function that awaited its promise",
  "is the loop over a stream that ends",
] as const;
type Ending = (typeof endings)[number];
async function ends(ending: Ending, gate: Promise<void>): Promise<number> {
  await gate;
  switch (ending) {
    case "throws":
    case "throws to the function that awaited its call":
      throw new RangeError("thrown by the frame that ends");
    case "waits for a promise that stays pending":
      await new Promise<void>(ignore);
      return 0;
    case "goes on in place and returns":
      return (await 1) + (await fulfilled) + (await quick(1));
    case "drains the queue and returns":
      drain();
      return 2;
    default:
      return 1;
  }
}
async function awaitsTheCall(ending: Ending, gate: Promise<void>): Promise<number> {
  try {
    return 1 + (await ends(ending, gate));
  } catch {
    return -1;
  }
}
async function awaitsThePromise(ending: Ending, gate: Promise<void>): Promise<number> {
  const pending = ends(ending, gate);
  return 1 + (await pending);
}
async function* streams(gate: Promise<void>): AsyncGenerator<number, void, unknown> {
  await gate;
  yield 1;
}
async function loopsOver(gate: Promise<void>): Promise<void> {
  for await (const value of streams(gate)) sink += value;
}
// Starts such a frame, which waits at a gate, and returns what opens the gate.
function begin(ending: Ending): Action {
  let open: Action = ignore;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  switch (ending) {
    case "returns to the function that awaited its call":
    case "throws to the function that awaited its call":
      void awaitsTheCall(ending, gate);
      break;
    case "returns to a function that awaited its promise":
      void awaitsThePromise(ending, gate);
      break;
    case "is the loop over a stream that ends":
      void loopsOver(gate);
      break;
    default:
      ends(ending, gate).catch(ignore);
  }
  return open;
}

let currentCall: () => unknown = ignore;
function probe(): void {
  isCalling = true;
  currentCall();
  isCalling = false;
}
function probeBelow(padding: [levels: number, extra: number]): void {
  const depth = below(padding[0], padding[1], probe);
  sink += depth;
}

const places: [place: string, reach: (ending: Ending, action: Action) => void][] = [
  [
    "a timer callback",
    (ending, action) => {
      begin(ending)();
      afterTimer(action);
    },
  ],
  [
    "a then handler",
    (ending, action) => {
      begin(ending)();
      afterJobs(16, action);
    },
  ],
  [
    "code behind a drain",
    (ending, action) =>
      soon(() => {
        begin(ending)();
        drain();
        action();
      }),
  ],
];
async function orderOf(reach: (ending: Ending, action: Action) => void, ending: Ending, call: () => unknown): Promise<string> {
  const own: string[] = [];
  await new Promise<void>(resolve => {
    reach(ending, () => {
      log = own;
      currentCall = call;
      own.push("calls");
      probe();
      own.push("the caller goes on");
      beat(own, 4);
      afterJobs(24, resolve);
    });
  });
  log = null;
  return own.join(" | ");
}

function sweepBehindDrains(ending: Ending): Promise<void> {
  return new Promise<void>(resolve => {
    soon(() => {
      for (const padding of paddings) {
        begin(ending)();
        drain();
        probeBelow(padding);
      }
      drain();
      resolve();
    });
  });
}
// One call a turn: the call comes first, then the next frame is started, and it has ended when the next turn begins.
function sweepInTurns(ending: Ending, next: (turn: Action) => void): Promise<void> {
  return new Promise<void>(resolve => {
    let index = 0;
    const turn = (): void => {
      if (index === paddings.length) {
        resolve();
        return;
      }
      probeBelow(paddings[index++]);
      begin(ending)();
      next(turn);
    };
    begin(ending)();
    next(turn);
  });
}
async function sweep(place: string, ending: Ending, kind: string, call: () => unknown, run: () => Promise<void>): Promise<void> {
  currentCall = call;
  arrivals = 0;
  early = 0;
  await run();
  lines.push(place + ", a frame that " + ending + ", a function that " + kind + ": " + paddings.length + " calls, " + arrivals + " arrivals, " + (early ? early + " WENT ON BEFORE THEIR CALLERS" : "every caller went on first"));
}

lines.push("== one call");
for (const ending of endings) {
  for (const [kind, call] of kinds) {
    for (const [place, reach] of places) lines.push(place + ", a frame that " + ending + ", a function that " + kind + ": " + (await orderOf(reach, ending, call)));
  }
}
lines.push("== calls at many depths");
for (const ending of endings) {
  for (const [kind, call, isSwept] of kinds) {
    if (!isSwept) continue;
    await sweep("code behind a drain", ending, kind, call, () => sweepBehindDrains(ending));
    await sweep("a callback of the event loop", ending, kind, call, () => sweepInTurns(ending, soon));
    // A frame that drains the queue would run the rest of this sweep inside itself.
    if (ending !== "drains the queue and returns") await sweep("a then handler", ending, kind, call, () => sweepInTurns(ending, turn => afterJobs(16, turn)));
  }
}
await sweep("a timer callback", "returns", "awaits a number", awaitsANumber, () => sweepInTurns("returns", afterTimer));
await sweep("a timer callback", "throws", "awaits a call that has finished", awaitsAFinishedCall, () => sweepInTurns("throws", afterTimer));
lines.push("sum " + sink);
console.log(lines.join("\n"));

export {};
