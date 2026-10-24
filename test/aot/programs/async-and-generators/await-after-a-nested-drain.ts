// A coroutine that a job has entered while nothing else is queued need not wait at an await of a settled value. Here such a coroutine calls into the host, which drains the job queue before it
// returns: other coroutines are entered and left below it, some end and resume their waiters, some drain the queue themselves. Whatever the coroutine does next (an await of a number, of a promise
// or of a call, a step of a stream, a yield, a return to its waiter, a throw) comes in the order of plain Bun, with nothing queued behind the drain and with a chain of jobs queued behind it.
declare const drainMicrotasks: undefined | (() => void);
const drain: () => void = typeof drainMicrotasks === "function" ? drainMicrotasks : require("bun:jsc").drainMicrotasks;
const settled = Promise.resolve();
const fulfilled = Promise.resolve("fulfilled");
const lines: string[] = [];
let log: string[] = [];

function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
// A chain of jobs of a given length: a turn that is lost or added beside it shows in the order of the log.
function beat(label: string, beats: number): void {
  let done = 0;
  const step = (): void => {
    log.push(label + " " + ++done);
    if (done < beats) settled.then(step);
  };
  settled.then(step);
}
async function steps(label: string, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await null;
    log.push(label + " " + i);
  }
}
async function chain(depth: number): Promise<number> {
  await settled;
  const below = depth ? await chain(depth - 1) : 0;
  log.push("chain " + depth);
  return below + 1;
}
async function* counts(label: string, count: number): AsyncGenerator<number, void, unknown> {
  for (let i = 1; i <= count; i++) {
    log.push(label + " yields " + i);
    yield i;
  }
}
async function consumes(label: string, count: number): Promise<void> {
  await null;
  for await (const value of counts(label, count)) log.push(label + " got " + value);
}
async function drainsToo(): Promise<void> {
  await null;
  log.push("inner begins");
  void steps("innermost", 2);
  drain();
  log.push("inner drained");
  log.push("inner got " + (await 0));
  log.push("inner got " + (await quick(1)));
}
async function quick(n: number): Promise<number> {
  return n + 1;
}
async function once(n: number): Promise<number> {
  await settled;
  return n + 1;
}

let open: (value: string) => void = () => {};
let gate: Promise<string> = fulfilled;
const works = ["nothing", "then handlers", "async functions", "a chain", "a stream", "a function that drains", "what opens the gate"] as const;
type Work = (typeof works)[number];
function queue(work: Work): void {
  gate = new Promise<string>(resolve => {
    open = resolve;
  });
  log.push("begins");
  switch (work) {
    case "nothing":
      break;
    case "then handlers":
      beat("then", 3);
      break;
    case "async functions":
      void steps("a", 2);
      void steps("b", 3);
      break;
    case "a chain":
      void chain(3).then(length => log.push("chain gave " + length));
      break;
    case "a stream":
      void consumes("stream", 2);
      break;
    case "a function that drains":
      void drainsToo();
      beat("then", 2);
      break;
    case "what opens the gate":
      void steps("opener", 2).then(() => open("opened in the drain"));
      break;
  }
}
function drained(queuesBehind: boolean): void {
  log.push("drained");
  if (queuesBehind) beat("behind", 5);
}

type Scene = (work: Work, queuesBehind: boolean) => Promise<unknown>;

async function awaitsNumbers(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  log.push("got " + (await 1));
  log.push("got " + (await 2));
}
async function awaitsAFulfilledPromise(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  log.push("got " + (await fulfilled));
  log.push("got " + (await fulfilled));
}
async function awaitsTheGate(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  if (work !== "what opens the gate") void steps("late opener", 3).then(() => open("opened behind the drain"));
  log.push("got " + (await gate));
  log.push("got " + (await 2));
}
async function awaitsCalls(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  log.push("got " + (await quick(1)));
  log.push("got " + (await once(2)));
  log.push("got " + (await quick(3)));
}
async function stepsAStream(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  for await (const value of counts("own stream", 2)) log.push("got " + value);
}
async function loopsOverAnArray(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  for await (const value of [1, fulfilled]) log.push("got " + value);
}
async function drainsTwice(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  queue(work);
  drain();
  log.push("drained once");
  void steps("between", 2);
  drain();
  drained(queuesBehind);
  log.push("got " + (await 1));
}
async function drainsBetweenAwaits(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  log.push("got " + (await 1));
  queue(work);
  drain();
  drained(queuesBehind);
  log.push("got " + (await 2));
  void steps("again", 1);
  drain();
  log.push("drained again");
  log.push("got " + (await 3));
}
function drainsBelow(work: Work, queuesBehind: boolean, depth: number): void {
  if (depth) return drainsBelow(work, queuesBehind, depth - 1);
  queue(work);
  drain();
  drained(queuesBehind);
}
async function drainsInACallee(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  drainsBelow(work, queuesBehind, 3);
  log.push("got " + (await 1));
  log.push("got " + (await quick(2)));
}
async function drainsInACallback(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  [0].forEach(() => {
    queue(work);
    drain();
    drained(queuesBehind);
  });
  log.push("got " + (await 1));
  log.push("got " + (await fulfilled));
}
function* drainsInside(work: Work, queuesBehind: boolean): Generator<number, void, unknown> {
  yield 1;
  queue(work);
  drain();
  drained(queuesBehind);
  yield 2;
}
async function stepsAGeneratorThatDrains(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  for (const value of drainsInside(work, queuesBehind)) log.push("stepped to " + value);
  log.push("got " + (await 1));
  log.push("got " + (await fulfilled));
}

async function drainsAndReturns(work: Work, queuesBehind: boolean): Promise<string> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  return "returned";
}
async function drainsAndThrows(work: Work, queuesBehind: boolean): Promise<string> {
  await afterTimer();
  queue(work);
  drain();
  drained(queuesBehind);
  throw new RangeError("thrown");
}
async function waitsForACall(work: Work, queuesBehind: boolean): Promise<void> {
  log.push("the waiter got " + (await drainsAndReturns(work, queuesBehind)));
  log.push("the waiter got " + (await 1));
}
async function waitsForAVariable(work: Work, queuesBehind: boolean): Promise<void> {
  const pending = drainsAndReturns(work, queuesBehind);
  log.push("the waiter got " + (await pending));
  log.push("the waiter got " + (await 1));
}
async function waitsWithAnother(work: Work, queuesBehind: boolean): Promise<void> {
  const pending = drainsAndReturns(work, queuesBehind);
  void pending.then(value => log.push("a then got " + value));
  log.push("the waiter got " + (await pending));
}
async function catchesFromACall(work: Work, queuesBehind: boolean): Promise<void> {
  try {
    await drainsAndThrows(work, queuesBehind);
  } catch (error) {
    log.push("the waiter caught " + (error as Error).message);
  }
  log.push("the waiter got " + (await 1));
}
async function catchesFromAVariable(work: Work, queuesBehind: boolean): Promise<void> {
  const pending = drainsAndThrows(work, queuesBehind);
  try {
    await pending;
  } catch (error) {
    log.push("the waiter caught " + (error as Error).message);
  }
}

async function* drainsBetweenYields(work: Work, queuesBehind: boolean): AsyncGenerator<string, void, unknown> {
  yield "first";
  queue(work);
  drain();
  drained(queuesBehind);
  yield "second";
  log.push("the body got " + (await 1));
  yield "third";
}
async function consumesWhatDrains(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  for await (const value of drainsBetweenYields(work, queuesBehind)) log.push("the consumer got " + value);
}
async function asksWhatDrains(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  const stream = drainsBetweenYields(work, queuesBehind);
  for (let result = await stream.next(); !result.done; result = await stream.next()) log.push("next() gave " + result.value);
}
async function drainsInTheLoop(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  for await (const value of counts("own stream", 2)) {
    log.push("got " + value);
    if (value === 1) {
      queue(work);
      drain();
      drained(queuesBehind);
    }
  }
}
async function* relaysAndDrains(work: Work, queuesBehind: boolean): AsyncGenerator<number, void, unknown> {
  for await (const value of counts("inner stream", 2)) {
    if (value === 2) {
      queue(work);
      drain();
      drained(queuesBehind);
    }
    yield value;
  }
}
async function consumesARelay(work: Work, queuesBehind: boolean): Promise<void> {
  await afterTimer();
  for await (const value of relaysAndDrains(work, queuesBehind)) log.push("the consumer got " + value);
}

const scenes: [label: string, scene: Scene][] = [
  ["awaits numbers", awaitsNumbers],
  ["awaits a fulfilled promise", awaitsAFulfilledPromise],
  ["awaits a promise that is fulfilled in the drain or behind it", awaitsTheGate],
  ["awaits calls", awaitsCalls],
  ["steps a stream", stepsAStream],
  ["loops over an array with for await", loopsOverAnArray],
  ["drains twice", drainsTwice],
  ["drains between awaits", drainsBetweenAwaits],
  ["drains in a callee", drainsInACallee],
  ["drains in a callback of a built-in", drainsInACallback],
  ["steps a generator that drains", stepsAGeneratorThatDrains],
  ["returns to a function that awaited the call", waitsForACall],
  ["returns to a function that awaited a variable", waitsForAVariable],
  ["returns to a function and a then handler", waitsWithAnother],
  ["throws to a function that awaited the call", catchesFromACall],
  ["throws to a function that awaited a variable", catchesFromAVariable],
  ["the body of a stream drains between yields", consumesWhatDrains],
  ["the same, asked by next()", asksWhatDrains],
  ["the consumer of a stream drains in its loop", drainsInTheLoop],
  ["a stream between two others drains", consumesARelay],
];
for (const [label, scene] of scenes) {
  lines.push("== " + label);
  for (const work of works) {
    for (const queuesBehind of [false, true]) {
      log = [];
      await scene(work, queuesBehind);
      log.push("over");
      await afterTimer();
      lines.push(work + (queuesBehind ? ", jobs behind: " : ": ") + log.join(" | "));
    }
  }
}

async function drainsOften(rounds: number): Promise<number> {
  await afterTimer();
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const pending = once(i);
    drain();
    sum += (await pending) + (await i) + (await quick(i));
  }
  return sum;
}
log = [];
lines.push("== a thousand drains", String(await drainsOften(1000)));
console.log(lines.join("\n"));

export {};
