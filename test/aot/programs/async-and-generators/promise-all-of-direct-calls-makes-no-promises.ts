// An element of `Promise.all([f(x), g(y)])` that is a direct call of an async function gets no promise of its own. Its result still lands at its index, in the turn of the job queue in which plain
// Bun puts it there, whether the function has finished inside the call, is suspended, waits for a direct call itself, returns a promise or a thenable, or throws, at once or later. The first
// rejection wins and the others count as handled. Where the list is never made, because a later element throws while it is evaluated, the functions that were started go on, and a rejection of
// theirs is reported as one that nobody handles. A list that the program can see, an element with a second use and another constructor get promises as ever.
// The lines under "counts" count the promises that are alive, which only the jsc shell can.
// IR+ PromiseAllOfElements .* directCalls=7
declare const gc: undefined | (() => void);
declare const drainMicrotasks: undefined | (() => void);
declare const memoryUsageStatistics: undefined | (() => { objectTypeCounts: Record<string, number> });
declare const setUnhandledRejectionCallback: undefined | ((callback: (promise: Promise<unknown>, reason: unknown) => void) => void);
const collect: () => void = typeof gc === "function" ? gc : () => Bun.gc(true);
const drain: () => void = typeof drainMicrotasks === "function" ? drainMicrotasks : require("bun:jsc").drainMicrotasks;
Error.stackTraceLimit = 12;
const settled = Promise.resolve();
const lines: string[] = [];
let log: string[] | null = null;

// A chain of jobs of a given length that runs beside what is tested: a turn that is lost or added shows in the numbers behind the notes.
let hasTicks = false;
let tick = 0;
let ticksLeft = 0;
function stepTick(): void {
  if (ticksLeft-- <= 0) return;
  tick++;
  settled.then(stepTick);
}
function startTicks(count: number): void {
  tick = 0;
  ticksLeft = count;
  settled.then(stepTick);
}
function note(text: string): void {
  if (log) log.push(hasTicks ? text + " @" + tick : text);
}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
function describe(value: unknown): string {
  if (value instanceof TypeError) return "a TypeError";
  if (value instanceof Error) return value.name + " (" + value.message + ")";
  if (Array.isArray(value)) return "[" + value.map(element => describe(element)).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.entries(value).map(([key, member]) => key + ": " + describe(member)).join(", ") + "}";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@.*?:(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + frame[3] + ":" + frame[4]);
  }
  return frames.join(" | ");
}
function reportUnhandled(reason: unknown): void {
  if (log) note("nobody handles " + describe(reason));
  else lines.push("nobody handles " + describe(reason));
}
if (typeof setUnhandledRejectionCallback === "function") setUnhandledRejectionCallback((promise, reason) => reportUnhandled(reason));
else process.on("unhandledRejection", reportUnhandled);

// With no turns it has finished when the call returns.
async function later(n: number, turns: number): Promise<number> {
  note(n + " begins");
  for (let i = 0; i < turns; i++) await settled;
  note(n + " ends");
  return n;
}
async function neverAwaits(n: number): Promise<number> {
  note(n + " begins and ends");
  return n;
}
async function waitsForACall(n: number, turns: number): Promise<number> {
  const below = await later(n, turns);
  note(n + " has waited for a call");
  return below + 100;
}
async function waitsForTwoCalls(n: number, turns: number): Promise<number> {
  const first = await later(n, turns);
  const second = await waitsForACall(n + 1, turns);
  return first * 1000 + second;
}
async function chain(n: number, depth: number): Promise<number> {
  if (!depth) return await later(n, 2);
  return 1000 + (await chain(n, depth - 1));
}
async function givesAPromise(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  note(n + " returns a promise");
  return Promise.resolve(n);
}
async function givesAPendingPromise(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  note(n + " returns a pending promise");
  return new Promise<number>(resolve => {
    settled.then(() => settled.then(() => resolve(n)));
  });
}
async function givesARejectedPromise(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  note(n + " returns a rejected promise");
  return Promise.reject(new RangeError("rejected " + n));
}
async function givesAThenable(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  note(n + " returns a thenable");
  return {
    then(resolve: any): any {
      note("then of " + n + " is called");
      resolve(n);
    },
  } as PromiseLike<number>;
}
async function givesARecord(n: number, turns: number): Promise<{ n: number }> {
  for (let i = 0; i < turns; i++) await settled;
  return { n };
}
async function fails(n: number, turns: number): Promise<number> {
  note(n + " begins");
  for (let i = 0; i < turns; i++) await settled;
  note(n + " throws");
  throw new RangeError("thrown by " + n);
}
async function failsBelow(n: number, turns: number): Promise<number> {
  return 100 + (await fails(n, turns));
}
async function catchesBelow(n: number, turns: number): Promise<string> {
  try {
    return "not thrown " + (await fails(n, turns));
  } catch (error) {
    return "caught " + describe(error);
  }
}
async function gathersBelow(n: number): Promise<number> {
  const [first, second, third] = await Promise.all([later(n, 1), later(n + 1, 0), waitsForACall(n + 2, 2)]);
  return first + second + third;
}
async function drainsInItsCall(n: number): Promise<number> {
  note(n + " drains the queue");
  drain();
  note(n + " has drained the queue");
  await settled;
  return n;
}
function throwsPlainly(): number {
  note("a plain function throws");
  throw new EvalError("thrown while the list is made");
}
function returnsPlainly(n: number): number {
  note("a plain function runs");
  return n;
}
const observed = {
  get value(): number {
    note("a getter runs");
    return 2;
  },
};
class Service {
  constructor(readonly base: number) {}
  async load(n: number, turns: number): Promise<number> {
    for (let i = 0; i < turns; i++) await settled;
    return this.base + n;
  }
  static async fixed(n: number): Promise<number> {
    await settled;
    return n * 2;
  }
}
const service = new Service(500);
const arrow = async (n: number): Promise<number> => {
  await settled;
  return n * 3;
};
function makes(offset: number): (n: number) => Promise<number> {
  return async n => {
    await settled;
    return n + offset;
  };
}
const closure = makes(700);
class Loud<T> extends Promise<T> {}
const plainThenable: PromiseLike<string> = {
  then(resolve: any): any {
    note("then of a plain thenable is called");
    resolve("from a thenable");
  },
};

async function awaitsTheList(): Promise<number[]> {
  return await Promise.all([later(1, 2), later(2, 0), later(3, 1)]);
}
async function waitsAndAwaitsTheList(): Promise<number[]> {
  await settled;
  const values = await Promise.all([later(1, 2), later(2, 0), later(3, 1)]);
  note("the function goes on");
  return values;
}
async function awaitsTwoLists(): Promise<number[]> {
  const first = await Promise.all([later(1, 1), later(2, 0)]);
  const second = await Promise.all([later(3, 0), later(4, 1)]);
  return [...first, ...second];
}
async function catchesTheRejection(): Promise<string> {
  try {
    return "not thrown " + (await Promise.all([later(1, 3), fails(2, 1), later(3, 0)])).join();
  } catch (error) {
    note("the function catches");
    return "caught " + describe(error);
  }
}
function returnsTheList(): Promise<number[]> {
  return Promise.all([later(1, 1), later(2, 3), later(3, 2)]);
}

const scenes: [label: string, run: () => Promise<unknown>][] = [
  ["three that are suspended", returnsTheList],
  ["three that have finished", () => Promise.all([later(1, 0), later(2, 0), later(3, 0)])],
  ["finished and suspended in turn", () => Promise.all([later(1, 0), later(2, 2), later(3, 0), later(4, 1)])],
  ["the first is the slowest", () => Promise.all([later(1, 5), later(2, 1), later(3, 3)])],
  ["one element", () => Promise.all([later(1, 2)])],
  ["one element that has finished", () => Promise.all([later(1, 0)])],
  ["functions that never await among them", () => Promise.all([neverAwaits(1), later(2, 1), neverAwaits(3), later(4, 0)])],
  ["elements that wait for direct calls", () => Promise.all([waitsForACall(1, 2), waitsForACall(2, 0), later(3, 1), waitsForACall(4, 1)])],
  ["elements that wait for two direct calls", () => Promise.all([waitsForTwoCalls(1, 1), waitsForTwoCalls(3, 0), waitsForTwoCalls(5, 2)])],
  ["elements that wait for chains of direct calls", () => Promise.all([chain(1, 3), chain(2, 0), chain(3, 6), chain(4, 1)])],
  ["elements that return promises", () => Promise.all([givesAPromise(1, 0), givesAPromise(2, 1), givesAPendingPromise(3, 1), givesAPendingPromise(4, 0), later(5, 1)])],
  ["elements that return thenables", () => Promise.all([givesAThenable(1, 0), givesAThenable(2, 2), later(3, 1)])],
  ["elements that return records", () => Promise.all([givesARecord(1, 0), givesARecord(2, 1), givesARecord(3, 2)])],
  ["the first throws at once", () => Promise.all([fails(1, 0), later(2, 2), later(3, 0)])],
  ["the last throws at once", () => Promise.all([later(1, 2), later(2, 0), fails(3, 0)])],
  ["one throws later", () => Promise.all([later(1, 3), fails(2, 1), later(3, 5)])],
  ["two throw, the second one first", () => Promise.all([fails(1, 3), fails(2, 1), later(3, 5)])],
  ["all throw at once", () => Promise.all([fails(1, 0), fails(2, 0), fails(3, 0)])],
  ["all throw later", () => Promise.all([fails(1, 2), fails(2, 2), fails(3, 1)])],
  ["one throws behind the last result", () => Promise.all([later(1, 1), later(2, 0), fails(3, 4)])],
  ["a direct call of an element throws", () => Promise.all([failsBelow(1, 1), later(2, 4), failsBelow(3, 0)])],
  ["an element catches what its direct call throws", () => Promise.all([catchesBelow(1, 1), later(2, 1), catchesBelow(3, 0)])],
  ["an element returns a rejected promise", () => Promise.all([givesARejectedPromise(1, 1), later(2, 4), givesARejectedPromise(3, 0)])],
  ["a later element is a plain call that throws", async () => await Promise.all([later(1, 2), later(2, 0), throwsPlainly()])],
  ["the same, and a function that was started throws", async () => await Promise.all([later(1, 2), fails(2, 1), fails(3, 0), throwsPlainly()])],
  ["an argument of a later element throws", async () => await Promise.all([later(1, 2), fails(2, 1), later(throwsPlainly(), 1)])],
  ["a getter runs between the calls", () => Promise.all([later(1, 1), later(observed.value, 1), later(3, 0)])],
  ["a plain call runs between the calls", () => Promise.all([later(1, 1), returnsPlainly(2), later(3, 1)])],
  ["a later element drains the queue in its call", () => Promise.all([later(1, 1), later(2, 3), waitsForACall(3, 1), drainsInItsCall(4), later(5, 0)])],
  ["values among the calls", () => Promise.all([later(1, 1), 2, "three", null, undefined, later(6, 0), { seven: 7 }])],
  ["promises among the calls", () => Promise.all([settled, later(2, 0), Promise.resolve("three"), later(4, 2)])],
  ["a thenable among the calls", () => Promise.all([later(1, 1), plainThenable, later(3, 0)])],
  ["an await in the list", async () => await Promise.all([later(1, 1), await later(2, 3), later(3, 1)])],
  ["a conditional element", () => Promise.all([later(1, 1), lines.length > 0 ? later(2, 1) : null, lines.length < 0 ? later(3, 1) : later(4, 0)])],
  ["lists in lists", () => Promise.all([gathersBelow(1), gathersBelow(10), Promise.all([later(20, 1), later(21, 0)])])],
  ["methods", () => Promise.all([service.load(1, 1), service.load(2, 0), Service.fixed(3)])],
  ["an arrow function and a closure", () => Promise.all([arrow(1), closure(2), arrow(3)])],
  ["arguments of other types", () => Promise.all([later("1" as any, 1), later(2, "1" as any), later(null as any, 0)])],
  [
    "forty elements",
    () =>
      Promise.all([
        later(0, 0), later(1, 1), later(2, 2), later(3, 3), later(4, 0), later(5, 1), later(6, 2), later(7, 3), later(8, 0), later(9, 1),
        later(10, 2), later(11, 3), later(12, 0), later(13, 1), later(14, 2), later(15, 3), later(16, 0), later(17, 1), later(18, 2), later(19, 3),
        later(20, 0), later(21, 1), later(22, 2), later(23, 3), later(24, 0), later(25, 1), later(26, 2), later(27, 3), later(28, 0), later(29, 1),
        waitsForACall(30, 2), waitsForACall(31, 3), waitsForACall(32, 0), waitsForACall(33, 1), later(34, 2), later(35, 3), later(36, 0), later(37, 1), later(38, 2), later(39, 3),
      ]),
  ],
  [
    "forty elements, the thirty-fifth throws",
    () =>
      Promise.all([
        later(0, 0), later(1, 1), later(2, 2), later(3, 3), later(4, 0), later(5, 1), later(6, 2), later(7, 3), later(8, 0), later(9, 1),
        later(10, 2), later(11, 3), later(12, 0), later(13, 1), later(14, 2), later(15, 3), later(16, 0), later(17, 1), later(18, 2), later(19, 3),
        later(20, 0), later(21, 1), later(22, 2), later(23, 3), later(24, 0), later(25, 1), later(26, 2), later(27, 3), later(28, 0), later(29, 1),
        later(30, 2), later(31, 3), later(32, 0), later(33, 1), fails(34, 2), later(35, 3), later(36, 0), later(37, 1), later(38, 2), later(39, 3),
      ]),
  ],
  ["awaited by a function that has not waited", awaitsTheList],
  ["awaited by a function that has waited", waitsAndAwaitsTheList],
  ["two lists, one behind the other", awaitsTwoLists],
  ["the function that awaits the list catches", catchesTheRejection],
  [
    "the promise is kept",
    async () => {
      const all = Promise.all([later(1, 2), later(2, 0)]);
      note("it is a promise: " + (all instanceof Promise && Object.getPrototypeOf(all) === Promise.prototype));
      void all.then(values => note("then gets " + values.join()));
      const first = await all;
      const second = await all;
      return [first === second, Array.isArray(first), first.length];
    },
  ],
  [
    "the result is an ordinary array",
    async () => {
      const values = await Promise.all([later(1, 0), later(2, 1)]);
      values.push(3);
      values[0] = 10;
      return [values, Object.getPrototypeOf(values) === Array.prototype, Object.keys(values)];
    },
  ],
  [
    "nobody takes the promise",
    async () => {
      void Promise.all([later(1, 1), later(2, 0)]);
      return "went on";
    },
  ],
  [
    "nobody takes the promise, and an element throws",
    async () => {
      void Promise.all([later(1, 1), fails(2, 2), fails(3, 1)]);
      return "went on";
    },
  ],
  [
    "the program keeps the list",
    async () => {
      const list = [later(1, 1), later(2, 0)];
      const all = Promise.all(list);
      note("its elements are promises: " + list.every(element => element instanceof Promise));
      return [await all, await list[0], await list[1]];
    },
  ],
  [
    "an element has a second use",
    async () => {
      const element = later(1, 2);
      const all = Promise.all([element, later(2, 1), element]);
      void element.then(value => note("then of the element gets " + value));
      return await all;
    },
  ],
  ["a spread in the list", () => Promise.all([later(1, 1), ...[later(2, 1), later(3, 0)], later(4, 0)])],
  ["a hole in the list", () => Promise.all([later(1, 1), , later(3, 0)])],
  [
    "a subclass of Promise",
    async () => {
      const all = Loud.all([later(1, 1), later(2, 0)]);
      note("it is an instance of the subclass: " + (all instanceof Loud));
      return await all;
    },
  ],
  ["all() called with call()", () => (Promise.all as any).call(Promise, [later(1, 1), later(2, 0)])],
  ["allSettled", () => Promise.allSettled([later(1, 1), fails(2, 0), fails(3, 1), later(4, 0)])],
  ["race", () => Promise.race([later(1, 2), later(2, 1), fails(3, 3)])],
  ["any", () => Promise.any([fails(1, 0), later(2, 2), later(3, 1)])],
  [
    "with collections",
    async () => {
      const all = Promise.all([givesARecord(1, 2), givesARecord(2, 4), waitsForACall(3, 5), chain(4, 3)]);
      collect();
      await settled;
      collect();
      const values = await all;
      collect();
      return values;
    },
  ],
];
async function runScenes(): Promise<void> {
  for (const [label, run] of scenes) {
    for (const withTicks of [false, true]) {
      const own: string[] = [];
      log = own;
      hasTicks = withTicks;
      if (withTicks) startTicks(40);
      try {
        note("gives " + describe(await run()));
      } catch (error) {
        note("rejects with " + describe(error));
      }
      await afterTimer();
      log = null;
      lines.push(label + (withTicks ? ", beside other jobs: " : ": ") + own.join(" | "));
    }
  }
}

async function makesAnError(turns: number): Promise<Error> {
  for (let i = 0; i < turns; i++) await settled;
  return new Error("made after " + turns + " turns");
}
async function makesAnErrorBelow(turns: number): Promise<Error> {
  return await makesAnError(turns);
}
async function gathersErrors(): Promise<Error[]> {
  return await Promise.all([makesAnError(0), makesAnError(1), makesAnErrorBelow(2)]);
}
async function catchesAnError(): Promise<unknown> {
  try {
    return await Promise.all([later(1, 3), failsBelow(2, 2)]);
  } catch (error) {
    return error;
  }
}
async function callsTheGatherers(): Promise<void> {
  for (const error of await gathersErrors()) lines.push(error.message + ": " + names(error));
  lines.push("thrown: " + names(await catchesAnError()));
}

let openGate: () => void = () => {};
let gate: Promise<void> = settled;
function closeGate(): void {
  gate = new Promise<void>(resolve => {
    openGate = resolve;
  });
}
async function waitsAtTheGate(n: number): Promise<number> {
  await gate;
  return n;
}
async function waitsBelow(n: number): Promise<number> {
  return 1 + (await waitsAtTheGate(n));
}
function gathersAtTheGate(n: number): Promise<number[]> {
  return Promise.all([waitsAtTheGate(n), waitsAtTheGate(n + 1), waitsAtTheGate(n + 2)]);
}
async function awaitsAtTheGate(n: number): Promise<number> {
  const [first, second, third] = await Promise.all([waitsAtTheGate(n), waitsBelow(n + 1), waitsBelow(n + 2)]);
  return first + second + third;
}
function livePromises(): number {
  if (typeof gc !== "function" || typeof memoryUsageStatistics !== "function") return 0;
  gc();
  return memoryUsageStatistics().objectTypeCounts.Promise ?? 0;
}
// A thousand lists of three functions, all suspended at one promise. An engine that makes a promise for every call holds three thousand more than `allowed`.
async function census(label: string, allowed: number, start: (n: number) => Promise<unknown>): Promise<void> {
  closeGate();
  const before = livePromises();
  const all: Promise<unknown>[] = [];
  for (let n = 0; n < 1000; n++) all.push(start(n));
  const held = livePromises() - before;
  openGate();
  const values = await Promise.all(all);
  lines.push(label + ": " + (held < allowed + 1000 ? "no promise for an element" : held + " PROMISES FOR 1000 LISTS OF THREE") + ", " + describe(values[0]) + " to " + describe(values[999]));
}

async function sums(rounds: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    const [first, second, third] = await Promise.all([later(i, 1), later(i, 0), waitsForACall(i, i % 3)]);
    sum += first + second * 2 + third * 3;
  }
  return sum;
}
async function sumsSideBySide(rounds: number): Promise<number> {
  const all: Promise<number[]>[] = [];
  for (let i = 0; i < rounds; i++) all.push(Promise.all([later(i, i % 4), waitsForACall(i, i % 3), gathersBelow(i)]));
  let sum = 0;
  for (const [first, second, third] of await Promise.all(all)) sum += first + second * 2 + third * 3;
  return sum;
}

lines.push("== order");
await runScenes();
lines.push("== at the top of the module");
lines.push(describe(await Promise.all([later(1, 1), later(2, 0), waitsForACall(3, 2)])));
lines.push("== stacks");
await callsTheGatherers();
lines.push("== counts");
await census("lists in a plain function", 1000, gathersAtTheGate);
await census("lists that async functions await", 2000, awaitsAtTheGate);
lines.push("== loops");
lines.push("5000 lists one after the other: " + (await sums(5_000)));
lines.push("1000 lists side by side: " + (await sumsSideBySide(1_000)));
await afterTimer();
console.log(lines.join("\n"));

export {};
