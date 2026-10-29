// An async function without an await runs to its end inside the call. Its caller gets a promise all the same, and whoever awaits the call waits for as many turns of the job queue as in plain Bun,
// whatever the function returns (a number, an object, a thenable, a promise in any state) or throws, in its body or in the head that evaluates its parameters. The calls are awaited at once, in a
// try, later, never, and as elements of Promise.all. A rejection that nobody handles is reported once, one that is handled is not, and the stack of an error names the same functions and positions.
// STATISTIC: AsyncWorkersMade >= 20
declare const setUnhandledRejectionCallback: undefined | ((callback: (promise: Promise<unknown>, reason: unknown) => void) => void);
Error.stackTraceLimit = 12;
const settled = Promise.resolve();
const shared = Promise.resolve(99);
const lines: string[] = [];
let touched = 0;

function ignore(): void {}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
function afterTwoJobs<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => {
    settled.then(() => settled.then(() => resolve(value)));
  });
}
// A chain of jobs that runs beside what is tested: a turn that is lost or added shows in the count.
interface Ticker {
  count: number;
  isOn: boolean;
}
function startTicker(): Ticker {
  const own: Ticker = { count: 0, isOn: true };
  const step = (): void => {
    if (!own.isOn) return;
    own.count++;
    settled.then(step);
  };
  settled.then(step);
  return own;
}
// The text of a TypeError is the engine's: only its name is compared.
function describe(value: unknown): string {
  if (value instanceof TypeError) return "a TypeError";
  if (value instanceof Error) return value.name + " (" + value.message + ")";
  if (value instanceof Promise) return "a promise";
  if (typeof value === "function") return "a function";
  if (Array.isArray(value)) return "[" + value.map(element => describe(element)).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.entries(value).map(([key, member]) => key + ": " + describe(member)).join(", ") + "}";
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "bigint" ? value + "n" : String(value);
}
function pair(first: unknown, second: unknown): string {
  return describe(first) + " then " + describe(second);
}
function caught(error: unknown): string {
  return "caught " + describe(error);
}
function names(error: unknown): string {
  const frames: string[] = [];
  for (const line of ((error as Error).stack ?? "").split("\n")) {
    const frame = /^\s*at (async )?(?:(.*?) \()?([^()]*?):(\d+):(\d+)\)?$/.exec(line) ?? /^(async )?(.*?)@(.*?):(\d+):(\d+)$/.exec(line);
    if (frame) frames.push((frame[1] ?? "") + (frame[2] === "module code" || frame[2] === "<anonymous>" ? "" : frame[2] ?? "") + ":" + (frame[3] === "native" ? frame[3] : frame[4] + ":" + frame[5]));
  }
  return frames.join(" | ");
}

const namesOfPromises = new Map<Promise<unknown>, string>();
function reportUnhandled(reason: unknown, promise: Promise<unknown>): void {
  lines.push("  nobody handles the rejection of " + (namesOfPromises.get(promise) ?? "a promise without a name") + ": " + describe(reason));
}
if (typeof setUnhandledRejectionCallback === "function") setUnhandledRejectionCallback((promise, reason) => reportUnhandled(reason, promise));
else process.on("unhandledRejection", reportUnhandled);

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Deferred {
  constructor(readonly value: number) {}
  then(resolve: (value: number) => void): void {
    lines.push("  then of an instance is called");
    resolve(this.value);
  }
}
function thenableFor(value: number): PromiseLike<number> {
  return {
    then(resolve: any): any {
      lines.push("  then is called");
      resolve(value);
    },
  };
}
function raise(n: number): number {
  throw new RangeError("thrown below " + n);
}

async function givesANumber(n: number): Promise<number> {
  return n + 1;
}
async function givesAFraction(n: number): Promise<number> {
  return n / 4;
}
async function givesAString(n: number): Promise<string> {
  return "s" + n;
}
async function givesNothing(n: number): Promise<void> {
  touched += n;
}
async function givesNull(n: number): Promise<null> {
  touched += n;
  return null;
}
async function givesARecord(n: number): Promise<{ n: number }> {
  return { n };
}
async function givesAnInstance(n: number): Promise<Point> {
  return new Point(n, n + 1);
}
async function givesAnArray(n: number): Promise<number[]> {
  return [n, n + 1];
}
async function givesAFunction(n: number): Promise<() => number> {
  return () => n;
}
async function givesAThenable(n: number): Promise<number> {
  return thenableFor(n);
}
async function givesAThenableInstance(n: number): Promise<number> {
  return new Deferred(n) as unknown as PromiseLike<number>;
}
async function givesAThenableThatRejects(n: number): Promise<number> {
  return {
    then(resolve: any, reject: any): any {
      reject(new EvalError("rejected by then " + n));
    },
  } as PromiseLike<number>;
}
async function givesAThenableThatThrows(n: number): Promise<number> {
  return {
    then(): any {
      throw new EvalError("thrown by then " + n);
    },
  } as PromiseLike<number>;
}
async function givesAnObjectWhoseThenThrows(n: number): Promise<unknown> {
  return {
    get then(): unknown {
      throw new EvalError("then was read " + n);
    },
  };
}
async function givesAnObjectWhoseThenIsANumber(n: number): Promise<unknown> {
  return { then: n };
}
async function givesAFulfilledPromise(n: number): Promise<number> {
  return Promise.resolve(n);
}
async function givesTheSamePromise(n: number): Promise<number> {
  touched += n;
  return shared;
}
async function givesAPendingPromise(n: number): Promise<number> {
  return afterTwoJobs(n);
}
async function givesARejectedPromise(n: number): Promise<number> {
  return Promise.reject(new RangeError("rejected " + n));
}
async function givesWhatAnotherGives(n: number): Promise<number> {
  return givesANumber(n);
}
async function waitsOnce(n: number): Promise<number> {
  await settled;
  return n + 1;
}
async function givesWhatAFunctionThatWaitsGives(n: number): Promise<number> {
  return waitsOnce(n);
}
async function throwsAnError(n: number): Promise<number> {
  throw new RangeError("thrown " + n);
}
async function throwsAString(n: number): Promise<number> {
  throw "a string " + n;
}
async function throwsUndefined(n: number): Promise<number> {
  touched += n;
  throw undefined;
}
async function throwsBelow(n: number): Promise<number> {
  return raise(n) + 1;
}
async function throwsForOddNumbers(n: number): Promise<number> {
  if (n % 2) throw new RangeError("odd " + n);
  return n;
}
async function catchesItsOwn(n: number): Promise<string> {
  try {
    return "returned " + raise(n);
  } catch (error) {
    return caught(error);
  } finally {
    touched++;
  }
}
async function throwsInItsHead(n: number, m: number = raise(n)): Promise<number> {
  return n + m;
}
async function takesAPattern({ n }: { n: number }): Promise<number> {
  return n;
}
async function readsArguments(n: number): Promise<number> {
  return arguments.length * 10 + n;
}
async function takesARest(...all: number[]): Promise<number> {
  return all.length;
}
async function loops(n: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i <= n; i++) sum += i;
  return sum;
}
async function callsItself(n: number): Promise<number> {
  return n > 0 ? callsItself(n - 1) : 0;
}
// This one has an await, which no call here reaches unless it asks for it.
async function awaitsOnlyWhenAsked(n: number, really: boolean): Promise<number> {
  if (really) await settled;
  return n;
}
const arrow = async (n: number): Promise<number> => n * 2;
class Service {
  constructor(readonly base: number) {}
  async read(n: number): Promise<number> {
    return this.base + n;
  }
  static async fixed(n: number): Promise<number> {
    return n * 3;
  }
  async #hidden(n: number): Promise<number> {
    return this.base - n;
  }
  async open(n: number): Promise<number> {
    return this.#hidden(n);
  }
}
const service = new Service(100);
const literal = {
  async member(n: number): Promise<number> {
    return n + 3;
  },
};
function makes(offset: number): (n: number) => Promise<number> {
  return async n => n + offset;
}
const closure = makes(1000);

type Call = (n: number) => Promise<unknown>;
// call: gives the promise. awaited: awaits the call twice, the first time in a function that has not been suspended, the second time in one that a job has entered.
// guarded: awaits it in a try. gathered: makes it the first and the last element of Promise.all.
type Row = [label: string, call: Call, awaited: Call, guarded: Call, gathered: Call];
const rows: Row[] = [
  [
    "a number",
    n => givesANumber(n),
    async n => pair(await givesANumber(n), await givesANumber(n + 1)),
    async n => { try { return await givesANumber(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesANumber(n), waitsOnce(n), givesANumber(n + 1)]),
  ],
  [
    "a fraction",
    n => givesAFraction(n),
    async n => pair(await givesAFraction(n), await givesAFraction(n + 1)),
    async n => { try { return await givesAFraction(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAFraction(n), waitsOnce(n), givesAFraction(n + 1)]),
  ],
  [
    "a string",
    n => givesAString(n),
    async n => pair(await givesAString(n), await givesAString(n + 1)),
    async n => { try { return await givesAString(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAString(n), waitsOnce(n), givesAString(n + 1)]),
  ],
  [
    "nothing",
    n => givesNothing(n),
    async n => pair(await givesNothing(n), await givesNothing(n + 1)),
    async n => { try { return await givesNothing(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesNothing(n), waitsOnce(n), givesNothing(n + 1)]),
  ],
  [
    "null",
    n => givesNull(n),
    async n => pair(await givesNull(n), await givesNull(n + 1)),
    async n => { try { return await givesNull(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesNull(n), waitsOnce(n), givesNull(n + 1)]),
  ],
  [
    "a record",
    n => givesARecord(n),
    async n => pair(await givesARecord(n), await givesARecord(n + 1)),
    async n => { try { return await givesARecord(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesARecord(n), waitsOnce(n), givesARecord(n + 1)]),
  ],
  [
    "an instance",
    n => givesAnInstance(n),
    async n => pair(await givesAnInstance(n), await givesAnInstance(n + 1)),
    async n => { try { return await givesAnInstance(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAnInstance(n), waitsOnce(n), givesAnInstance(n + 1)]),
  ],
  [
    "an array",
    n => givesAnArray(n),
    async n => pair(await givesAnArray(n), await givesAnArray(n + 1)),
    async n => { try { return await givesAnArray(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAnArray(n), waitsOnce(n), givesAnArray(n + 1)]),
  ],
  [
    "a function",
    n => givesAFunction(n),
    async n => pair(await givesAFunction(n), await givesAFunction(n + 1)),
    async n => { try { return await givesAFunction(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAFunction(n), waitsOnce(n), givesAFunction(n + 1)]),
  ],
  [
    "a thenable",
    n => givesAThenable(n),
    async n => pair(await givesAThenable(n), await givesAThenable(n + 1)),
    async n => { try { return await givesAThenable(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAThenable(n), waitsOnce(n), givesAThenable(n + 1)]),
  ],
  [
    "an instance with a method then",
    n => givesAThenableInstance(n),
    async n => pair(await givesAThenableInstance(n), await givesAThenableInstance(n + 1)),
    async n => { try { return await givesAThenableInstance(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAThenableInstance(n), waitsOnce(n), givesAThenableInstance(n + 1)]),
  ],
  [
    "a thenable that rejects",
    n => givesAThenableThatRejects(n),
    async n => pair(await givesAThenableThatRejects(n), await givesAThenableThatRejects(n + 1)),
    async n => { try { return await givesAThenableThatRejects(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAThenableThatRejects(n), waitsOnce(n), givesAThenableThatRejects(n + 1)]),
  ],
  [
    "a thenable that throws",
    n => givesAThenableThatThrows(n),
    async n => pair(await givesAThenableThatThrows(n), await givesAThenableThatThrows(n + 1)),
    async n => { try { return await givesAThenableThatThrows(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAThenableThatThrows(n), waitsOnce(n), givesAThenableThatThrows(n + 1)]),
  ],
  [
    "an object whose then throws when it is read",
    n => givesAnObjectWhoseThenThrows(n),
    async n => pair(await givesAnObjectWhoseThenThrows(n), await givesAnObjectWhoseThenThrows(n + 1)),
    async n => { try { return await givesAnObjectWhoseThenThrows(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAnObjectWhoseThenThrows(n), waitsOnce(n), givesAnObjectWhoseThenThrows(n + 1)]),
  ],
  [
    "an object whose then is a number",
    n => givesAnObjectWhoseThenIsANumber(n),
    async n => pair(await givesAnObjectWhoseThenIsANumber(n), await givesAnObjectWhoseThenIsANumber(n + 1)),
    async n => { try { return await givesAnObjectWhoseThenIsANumber(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAnObjectWhoseThenIsANumber(n), waitsOnce(n), givesAnObjectWhoseThenIsANumber(n + 1)]),
  ],
  [
    "a fulfilled promise",
    n => givesAFulfilledPromise(n),
    async n => pair(await givesAFulfilledPromise(n), await givesAFulfilledPromise(n + 1)),
    async n => { try { return await givesAFulfilledPromise(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAFulfilledPromise(n), waitsOnce(n), givesAFulfilledPromise(n + 1)]),
  ],
  [
    "the same fulfilled promise every time",
    n => givesTheSamePromise(n),
    async n => pair(await givesTheSamePromise(n), await givesTheSamePromise(n + 1)),
    async n => { try { return await givesTheSamePromise(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesTheSamePromise(n), waitsOnce(n), givesTheSamePromise(n + 1)]),
  ],
  [
    "a pending promise",
    n => givesAPendingPromise(n),
    async n => pair(await givesAPendingPromise(n), await givesAPendingPromise(n + 1)),
    async n => { try { return await givesAPendingPromise(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesAPendingPromise(n), waitsOnce(n), givesAPendingPromise(n + 1)]),
  ],
  [
    "a rejected promise",
    n => givesARejectedPromise(n),
    async n => pair(await givesARejectedPromise(n), await givesARejectedPromise(n + 1)),
    async n => { try { return await givesARejectedPromise(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesARejectedPromise(n), waitsOnce(n), givesARejectedPromise(n + 1)]),
  ],
  [
    "the promise of another function that never awaits",
    n => givesWhatAnotherGives(n),
    async n => pair(await givesWhatAnotherGives(n), await givesWhatAnotherGives(n + 1)),
    async n => { try { return await givesWhatAnotherGives(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesWhatAnotherGives(n), waitsOnce(n), givesWhatAnotherGives(n + 1)]),
  ],
  [
    "the promise of a function that waits",
    n => givesWhatAFunctionThatWaitsGives(n),
    async n => pair(await givesWhatAFunctionThatWaitsGives(n), await givesWhatAFunctionThatWaitsGives(n + 1)),
    async n => { try { return await givesWhatAFunctionThatWaitsGives(n); } catch (error) { return caught(error); } },
    n => Promise.all([givesWhatAFunctionThatWaitsGives(n), waitsOnce(n), givesWhatAFunctionThatWaitsGives(n + 1)]),
  ],
  [
    "throws an error",
    n => throwsAnError(n),
    async n => pair(await throwsAnError(n), await throwsAnError(n + 1)),
    async n => { try { return await throwsAnError(n); } catch (error) { return caught(error); } },
    n => Promise.all([throwsAnError(n), waitsOnce(n), throwsAnError(n + 1)]),
  ],
  [
    "throws a string",
    n => throwsAString(n),
    async n => pair(await throwsAString(n), await throwsAString(n + 1)),
    async n => { try { return await throwsAString(n); } catch (error) { return caught(error); } },
    n => Promise.all([throwsAString(n), waitsOnce(n), throwsAString(n + 1)]),
  ],
  [
    "throws undefined",
    n => throwsUndefined(n),
    async n => pair(await throwsUndefined(n), await throwsUndefined(n + 1)),
    async n => { try { return await throwsUndefined(n); } catch (error) { return caught(error); } },
    n => Promise.all([throwsUndefined(n), waitsOnce(n), throwsUndefined(n + 1)]),
  ],
  [
    "a function that it calls throws",
    n => throwsBelow(n),
    async n => pair(await throwsBelow(n), await throwsBelow(n + 1)),
    async n => { try { return await throwsBelow(n); } catch (error) { return caught(error); } },
    n => Promise.all([throwsBelow(n), waitsOnce(n), throwsBelow(n + 1)]),
  ],
  [
    "throws for odd numbers",
    n => throwsForOddNumbers(n),
    async n => pair(await throwsForOddNumbers(n), await throwsForOddNumbers(n + 1)),
    async n => { try { return await throwsForOddNumbers(n + 1); } catch (error) { return caught(error); } },
    n => Promise.all([throwsForOddNumbers(n), waitsOnce(n), throwsForOddNumbers(n + 1)]),
  ],
  [
    "catches what it throws",
    n => catchesItsOwn(n),
    async n => pair(await catchesItsOwn(n), await catchesItsOwn(n + 1)),
    async n => { try { return await catchesItsOwn(n); } catch (error) { return caught(error); } },
    n => Promise.all([catchesItsOwn(n), waitsOnce(n), catchesItsOwn(n + 1)]),
  ],
  [
    "the default of a parameter throws",
    n => throwsInItsHead(n),
    async n => pair(await throwsInItsHead(n, 1), await throwsInItsHead(n + 1)),
    async n => { try { return await throwsInItsHead(n); } catch (error) { return caught(error); } },
    n => Promise.all([throwsInItsHead(n, 2), waitsOnce(n), throwsInItsHead(n + 1)]),
  ],
  [
    "a pattern takes null apart",
    n => takesAPattern(n % 2 ? { n } : (null as any)),
    async n => pair(await takesAPattern({ n }), await takesAPattern(null as any)),
    async n => { try { return await takesAPattern(n % 2 ? { n } : (undefined as any)); } catch (error) { return caught(error); } },
    n => Promise.all([takesAPattern({ n }), waitsOnce(n), takesAPattern(null as any)]),
  ],
  [
    "reads arguments",
    n => readsArguments(n),
    async n => pair(await readsArguments(n), await (readsArguments as any)(n + 1, 2, 3)),
    async n => { try { return await readsArguments(n); } catch (error) { return caught(error); } },
    n => Promise.all([readsArguments(n), waitsOnce(n), readsArguments(n + 1)]),
  ],
  [
    "takes a rest",
    n => takesARest(n, n),
    async n => pair(await takesARest(), await takesARest(n, n, n)),
    async n => { try { return await takesARest(...[n, n]); } catch (error) { return caught(error); } },
    n => Promise.all([takesARest(n), waitsOnce(n), takesARest(n, n)]),
  ],
  [
    "loops",
    n => loops(n),
    async n => pair(await loops(n), await loops(n + 1)),
    async n => { try { return await loops(n); } catch (error) { return caught(error); } },
    n => Promise.all([loops(n), waitsOnce(n), loops(n + 1)]),
  ],
  [
    "calls itself",
    n => callsItself(n),
    async n => pair(await callsItself(n), await callsItself(0)),
    async n => { try { return await callsItself(n); } catch (error) { return caught(error); } },
    n => Promise.all([callsItself(n), waitsOnce(n), callsItself(1)]),
  ],
  [
    "has an await that is not reached",
    n => awaitsOnlyWhenAsked(n, false),
    async n => pair(await awaitsOnlyWhenAsked(n, false), await awaitsOnlyWhenAsked(n + 1, false)),
    async n => { try { return await awaitsOnlyWhenAsked(n, false); } catch (error) { return caught(error); } },
    n => Promise.all([awaitsOnlyWhenAsked(n, false), waitsOnce(n), awaitsOnlyWhenAsked(n + 1, true)]),
  ],
  [
    "an arrow function",
    n => arrow(n),
    async n => pair(await arrow(n), await arrow(n + 1)),
    async n => { try { return await arrow(n); } catch (error) { return caught(error); } },
    n => Promise.all([arrow(n), waitsOnce(n), arrow(n + 1)]),
  ],
  [
    "a method",
    n => service.read(n),
    async n => pair(await service.read(n), await service.read(n + 1)),
    async n => { try { return await service.read(n); } catch (error) { return caught(error); } },
    n => Promise.all([service.read(n), waitsOnce(n), service.read(n + 1)]),
  ],
  [
    "a static method",
    n => Service.fixed(n),
    async n => pair(await Service.fixed(n), await Service.fixed(n + 1)),
    async n => { try { return await Service.fixed(n); } catch (error) { return caught(error); } },
    n => Promise.all([Service.fixed(n), waitsOnce(n), Service.fixed(n + 1)]),
  ],
  [
    "a method that returns the promise of a private one",
    n => service.open(n),
    async n => pair(await service.open(n), await service.open(n + 1)),
    async n => { try { return await service.open(n); } catch (error) { return caught(error); } },
    n => Promise.all([service.open(n), waitsOnce(n), service.open(n + 1)]),
  ],
  [
    "a member of a literal",
    n => literal.member(n),
    async n => pair(await literal.member(n), await literal.member(n + 1)),
    async n => { try { return await literal.member(n); } catch (error) { return caught(error); } },
    n => Promise.all([literal.member(n), waitsOnce(n), literal.member(n + 1)]),
  ],
  [
    "a closure",
    n => closure(n),
    async n => pair(await closure(n), await closure(n + 1)),
    async n => { try { return await closure(n); } catch (error) { return caught(error); } },
    n => Promise.all([closure(n), waitsOnce(n), closure(n + 1)]),
  ],
];

async function outcomeOf(run: () => Promise<unknown>, withTicks: boolean): Promise<string> {
  const ticker = withTicks ? startTicker() : null;
  let outcome: string;
  try {
    outcome = "gives " + describe(await run());
  } catch (error) {
    outcome = "rejects with " + describe(error);
  }
  if (!ticker) return outcome;
  ticker.isOn = false;
  return outcome + " after " + ticker.count + " ticks";
}
async function runAwaited(withTicks: boolean): Promise<void> {
  lines.push(withTicks ? "== awaited, beside other jobs" : "== awaited, alone");
  for (const [label, , awaited, guarded, gathered] of rows) {
    lines.push(label + ", awaited twice: " + (await outcomeOf(() => awaited(4), withTicks)));
    lines.push(label + ", awaited in a try: " + (await outcomeOf(() => guarded(6), withTicks)));
    lines.push(label + ", in Promise.all: " + (await outcomeOf(() => gathered(8), withTicks)));
  }
}
async function runKept(): Promise<void> {
  lines.push("== the promise is kept");
  for (const [label, call] of rows) {
    const promise = call(10);
    const ticker = startTicker();
    const isOrdinary = promise instanceof Promise && Object.getPrototypeOf(promise) === Promise.prototype;
    const outcome = await new Promise<string>(resolve => {
      promise.then(
        value => resolve("fulfilled with " + describe(value) + " at tick " + ticker.count),
        error => resolve("rejected with " + describe(error) + " at tick " + ticker.count),
      );
    });
    ticker.isOn = false;
    lines.push(label + ", then(): " + (isOrdinary ? "an ordinary promise, " : "NO ORDINARY PROMISE, ") + outcome);

    const late = call(12);
    for (let turn = 0; turn < 6; turn++) await settled;
    lines.push(label + ", awaited six turns later: " + (await outcomeOf(() => late, true)));

    const two = [call(14), call(14)];
    lines.push(label + ", two calls: " + (two[0] === two[1] ? "THE SAME PROMISE" : "two promises") + ", " + (await outcomeOf(() => Promise.allSettled(two), false)));
  }
}
async function runDropped(): Promise<void> {
  lines.push("== nobody takes the promise");
  for (const [label, call] of rows) {
    lines.push(label + ":");
    const promise = call(16);
    namesOfPromises.set(promise, "the promise of the call");
    await afterTimer();
    promise.catch(ignore);
    namesOfPromises.delete(promise);
  }
}

async function returnsTheCall(n: number): Promise<number> {
  return givesANumber(n);
}
async function waitsAndReturnsTheCall(n: number): Promise<number> {
  await settled;
  return givesANumber(n);
}
async function waitsAndReturnsACallThatThrows(n: number): Promise<number> {
  await settled;
  return throwsAnError(n);
}
async function awaitsEither(n: number): Promise<unknown> {
  return await (n % 2 ? givesANumber(n) : givesAString(n));
}
async function awaitsEitherOrAValue(n: number): Promise<unknown> {
  return await (n % 2 ? givesARecord(n) : n);
}
async function awaitsNestedCalls(n: number): Promise<number> {
  return await givesANumber(await givesANumber(await givesANumber(n)));
}
async function awaitsInAFinally(n: number): Promise<string> {
  let text = "";
  try {
    text += await throwsAnError(n);
  } catch (error) {
    text += caught(error) + ", " + (await givesAString(n));
  } finally {
    text += ", " + (await givesANumber(n));
  }
  return text;
}
async function throwsPastItsFinally(n: number): Promise<number> {
  try {
    return await throwsAnError(n);
  } finally {
    lines.push("  the finally of the caller runs");
  }
}
async function runOtherWays(withTicks: boolean): Promise<void> {
  lines.push(withTicks ? "== other ways to call, beside other jobs" : "== other ways to call, alone");
  const ways: [label: string, run: () => Promise<unknown>][] = [
    ["call()", () => givesANumber.call(null, 1)],
    ["apply()", () => givesANumber.apply(null, [2])],
    ["bind()", () => givesANumber.bind(null, 3)()],
    ["Reflect.apply()", () => Reflect.apply(givesANumber, undefined, [4])],
    ["awaited call()", async () => await givesANumber.call(null, 5)],
    ["a callback of map", () => Promise.all([1, 2, 3].map(givesANumber))],
    ["a callback of map that reads arguments", () => Promise.all([1, 2].map(readsArguments))],
    ["a then handler", () => settled.then(() => 6).then(givesANumber)],
    ["a then handler that throws", () => settled.then(() => 7).then(throwsAnError)],
    ["a catch handler", () => Promise.reject(8).catch(givesANumber)],
    ["a finally handler", () => Promise.resolve(9).finally(() => givesAString(9))],
    ["a finally handler that throws", () => Promise.resolve(10).finally(() => throwsAnError(10))],
    ["race", () => Promise.race([givesANumber(11), givesAString(11)])],
    ["race with one that waits", () => Promise.race([waitsOnce(12), givesAString(12)])],
    ["allSettled", () => Promise.allSettled([throwsAnError(13), givesANumber(13), givesAThenable(13)])],
    ["any", () => Promise.any([throwsAnError(14), givesARejectedPromise(14), givesANumber(14)])],
    ["Promise.resolve of the call", () => Promise.resolve(givesANumber(15))],
    ["returned by a function that never awaits", () => returnsTheCall(16)],
    ["returned by a function that has waited", () => waitsAndReturnsTheCall(17)],
    ["a call that throws, returned by a function that has waited", () => waitsAndReturnsACallThatThrows(18)],
    ["one of two calls, the first", () => awaitsEither(19)],
    ["one of two calls, the second", () => awaitsEither(20)],
    ["a call or a value, the call", () => awaitsEitherOrAValue(21)],
    ["a call or a value, the value", () => awaitsEitherOrAValue(22)],
    ["calls in the arguments of calls", () => awaitsNestedCalls(23)],
    ["calls in try, catch and finally", () => awaitsInAFinally(24)],
    ["a call that throws past a finally", () => throwsPastItsFinally(25)],
    ["a string for a number", async () => await givesANumber("26" as any)],
    ["a symbol for a number", async () => await givesAString(Symbol("27") as any)],
    ["a bigint for a number", async () => await givesANumber(28n as any)],
    ["a thenable for a number", async () => await awaitsOnlyWhenAsked(thenableFor(29) as any, false)],
    ["a method on another object", async () => await service.read.call({ base: "base " } as any, 30)],
    ["a method on null", async () => await service.read.call(null as any, 31)],
    ["a private method on another object", async () => await service.open.call({ base: 1 } as any, 32)],
    ["new", async () => new (givesANumber as any)(33)],
  ];
  for (const [label, run] of ways) lines.push(label + ": " + (await outcomeOf(run, withTicks)));
}

function runProperties(): void {
  lines.push("== what the functions are");
  const asyncFunctionPrototype: object = Object.getPrototypeOf(waitsOnce);
  const functions: [label: string, f: Function][] = [
    ["declared", givesANumber],
    ["with a default", throwsInItsHead],
    ["with a rest", takesARest],
    ["an arrow function", arrow],
    ["a method", service.read],
    ["a static method", Service.fixed],
    ["a member of a literal", literal.member],
    ["a closure", closure],
  ];
  for (const [label, f] of functions) {
    lines.push(
      label + ": " + [typeof f, JSON.stringify(f.name), f.length, Object.getPrototypeOf(f) === asyncFunctionPrototype, Object.prototype.toString.call(f), "prototype" in f, Object.getOwnPropertyNames(f).sort().join("+")].join(" "),
    );
  }
}

async function makesAnError(n: number): Promise<Error> {
  return new Error("made " + n);
}
async function makesItBelow(n: number): Promise<Error> {
  return makesAnError(n);
}
// Not `return new Error(..)`: plain Bun's transpiler writes that as `return Error(..)`, a proper tail call, which takes the frame of this function out of the trace.
let lastMade: Error | undefined;
function makesItInAPlainFunction(n: number): Error {
  const made = new Error("made in a plain function " + n);
  lastMade = made;
  return made;
}
async function makesItThroughAPlainFunction(n: number): Promise<Error> {
  return makesItInAPlainFunction(n);
}
async function throwsItBelow(n: number): Promise<number> {
  return raise(n);
}
class Maker {
  async make(n: number): Promise<Error> {
    return new Error("made by a method " + n);
  }
}
const maker = new Maker();
// Each caller makes its call either before it has ever been suspended, on the stack of its own caller, or behind an await, entered by a job.
async function awaitsWhatIsMade(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  return await makesAnError(1);
}
async function awaitsWhatIsMadeBelow(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  return await makesItBelow(2);
}
async function awaitsWhatAPlainFunctionMakes(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  return await makesItThroughAPlainFunction(3);
}
async function awaitsWhatAMethodMakes(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  return await maker.make(4);
}
async function catchesWhatIsThrown(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  try {
    return await throwsAnError(5);
  } catch (error) {
    return error;
  }
}
async function catchesWhatIsThrownBelow(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  try {
    return await throwsItBelow(6);
  } catch (error) {
    return error;
  }
}
async function catchesWhatTheHeadThrows(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  try {
    return await throwsInItsHead(7);
  } catch (error) {
    return error;
  }
}
async function keepsThePromiseFirst(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  const kept = makesAnError(8);
  return await kept;
}
async function returnsThePromise(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  return makesAnError(9);
}
async function gathersWhatIsMade(waitsFirst: boolean): Promise<unknown> {
  if (waitsFirst) await settled;
  const [first] = await Promise.all([makesAnError(10), waitsOnce(10)]);
  return first;
}
const stackCases: [label: string, run: (waitsFirst: boolean) => Promise<unknown>][] = [
  ["made", awaitsWhatIsMade],
  ["made a call below", awaitsWhatIsMadeBelow],
  ["made in a plain function", awaitsWhatAPlainFunctionMakes],
  ["made by a method", awaitsWhatAMethodMakes],
  ["thrown", catchesWhatIsThrown],
  ["thrown a call below", catchesWhatIsThrownBelow],
  ["thrown in the head", catchesWhatTheHeadThrows],
  ["the promise is kept first", keepsThePromiseFirst],
  ["the promise is returned", returnsThePromise],
  ["in Promise.all", gathersWhatIsMade],
];
async function collectsStacks(): Promise<void> {
  for (const waitsFirst of [false, true]) {
    for (const [label, run] of stackCases) lines.push(label + (waitsFirst ? ", behind an await of the caller: " : ", before the caller has waited: ") + names(await run(waitsFirst)));
  }
}
async function callsTheCollector(): Promise<void> {
  await collectsStacks();
}

async function sums(rounds: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += await givesANumber(i);
  return sum;
}
async function sumsOfSeveralKinds(rounds: number): Promise<string> {
  let sum = 0;
  let failures = 0;
  for (let i = 0; i < rounds; i++) {
    sum += (await givesAnInstance(i)).y + (await givesARecord(i)).n + (await service.read(i)) + (await givesAString(i)).length;
    try {
      sum += await throwsForOddNumbers(i);
    } catch {
      failures++;
    }
  }
  return sum + " and " + failures + " failures";
}

for (const withTicks of [false, true, false, true]) await runAwaited(withTicks);
await runKept();
await runDropped();
for (const withTicks of [false, true]) await runOtherWays(withTicks);
runProperties();
lines.push("== stacks");
await callsTheCollector();
lines.push("== loops");
for (const withTicks of [false, true]) {
  lines.push("20000 awaited calls" + (withTicks ? ", beside other jobs: " : ", alone: ") + (await outcomeOf(() => sums(20_000), withTicks)));
  lines.push("2000 rounds of several kinds" + (withTicks ? ", beside other jobs: " : ", alone: ") + (await outcomeOf(() => sumsOfSeveralKinds(2_000), withTicks)));
}
await afterTimer();
lines.push("touched " + touched);
console.log(lines.join("\n"));

export {};
