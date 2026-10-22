// `await f(x)` of an async function with typed parameters makes no promise for the call, whether x has the declared type or, through `any`, another one, and neither does `await o.m(x)` where o
// is an instance of one of two classes: the calls stand in the arms of a test and the await stands where the arms meet. Results, errors and the number of turns are those of plain Bun.
// The last lines count promises and entries of the runtime, which only the jsc shell can.
// STATISTIC: AwaitsSunkIntoPredecessors >= 2
declare const aotOperationCount: undefined | ((name: string) => number);
declare const memoryUsageStatistics: undefined | (() => { objectTypeCounts: Record<string, number> });
declare const gc: undefined | (() => void);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const lines: string[] = [];
const settled = Promise.resolve();

// A chain of jobs that runs beside what is tested: a turn that is lost or added shows in the count.
function startTicks(): () => number {
  let count = 0;
  let isOn = true;
  const step = (): void => {
    if (!isOn) return;
    count++;
    settled.then(step);
  };
  settled.then(step);
  return () => {
    isOn = false;
    return count;
  };
}
function describe(value: unknown): string {
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return typeof value + " " + String(value);
}
function both(first: unknown, second: unknown): string {
  return describe(first) + " then " + describe(second);
}
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : "what is no error: " + describe(error);
}
function thenableFor(label: string, value: unknown): any {
  return {
    then(resolve: (value: unknown) => void): void {
      lines.push("  then of " + label + " is called");
      resolve(value);
    },
  };
}
function afterTwoJobs<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => {
    settled.then(() => settled.then(() => resolve(value)));
  });
}

interface Point {
  x: number;
  y: number;
}
class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Meter {
  constructor(
    public unit: string,
    public factor: number,
  ) {}
}
class Kilometer extends Meter {
  constructor() {
    super("km", 1000);
  }
}

async function neverAwaits(n: number): Promise<number> {
  return n + n;
}
async function awaitsOnce(n: number): Promise<number> {
  await settled;
  return n + n;
}
async function awaitsOddNumbers(n: number): Promise<number> {
  if (n % 2 === 1) await settled;
  return n + 1;
}
async function returnsItsArgument(n: number): Promise<number> {
  return n;
}
async function returnsItLater(n: number): Promise<number> {
  await settled;
  return n;
}
async function readsARecord(point: Point, scale: number): Promise<number> {
  const x = point.x * scale;
  await null;
  return x + point.y;
}
async function readsAnInstance(meter: Meter, amount: number): Promise<string> {
  await settled;
  return amount * meter.factor + meter.unit;
}
async function callsAStringMethod(text: string): Promise<string> {
  const upper = text.toUpperCase();
  await settled;
  return upper + text.length;
}
async function callsItLater(text: string): Promise<string> {
  await settled;
  return text.toUpperCase();
}
async function sumsAnArray(list: number[]): Promise<number> {
  let sum = 0;
  for (const n of list) sum += await n;
  return sum;
}
async function hasDefaults(n: number = 5, label: string = "d"): Promise<string> {
  await null;
  return label + n;
}
async function callsBack(callback: (n: number) => number, n: number): Promise<number> {
  await settled;
  return callback(n) + 1;
}
async function takesEither(value: number | string): Promise<string> {
  if (typeof value === "number") return "number " + (value + 1);
  await settled;
  return "string " + value.length;
}
async function callsTypedFunctions(n: number): Promise<number> {
  return 1 + (await awaitsOnce(n)) + (await neverAwaits(n));
}

class Quick {
  constructor(readonly base: number) {}
  async read(n: number): Promise<number> {
    return this.base + n;
  }
}
class Patient {
  constructor(readonly base: number) {}
  async read(n: number): Promise<number> {
    await settled;
    return this.base * n;
  }
}
class Loud extends Quick {
  async read(n: number): Promise<number> {
    lines.push("  read of a subclass is called");
    return 100 + (await super.read(n));
  }
}
async function readsEither(source: Quick | Patient, n: number): Promise<number> {
  return 1 + (await source.read(n));
}
const quick = new Quick(10);
const patient = new Patient(10);

type Row = [label: string, make: () => unknown];
type Call = (value: any) => Promise<string>;

const numbers: Row[] = [
  ["21", () => 21],
  ["1.5", () => 1.5],
  ["the string 21", () => "21"],
  ["undefined", () => undefined],
  ["null", () => null],
  ["true", () => true],
  ["a bigint", () => 4n],
  ["a symbol", () => Symbol("s")],
  ["an object with valueOf", () => ({ valueOf: () => 8 })],
  ["an array", () => [3]],
  ["22", () => 22],
];
const resolutions: Row[] = [
  ["7", () => 7],
  ["a thenable", () => thenableFor("the argument", 8)],
  ["a fulfilled promise", () => Promise.resolve(9)],
  ["a rejected promise", () => Promise.reject(new RangeError("rejected"))],
  ["a pending promise", () => afterTwoJobs(10)],
  ["a function", () => () => 11],
  ["an object whose then is a number", () => ({ then: 12 })],
  [
    "an object whose then throws",
    () => ({
      get then(): unknown {
        throw new EvalError("then was read");
      },
    }),
  ],
  ["13", () => 13],
];
const points: Row[] = [
  ["a point", () => ({ x: 2, y: 3 })],
  ["a point with more", () => ({ x: 2, y: 3, z: 4 })],
  ["a point in another order", () => ({ y: 3, x: 2 })],
  ["strings for numbers", () => ({ x: "2", y: "3" })],
  ["a point without x", () => ({ y: 3 })],
  [
    "getters",
    () => ({
      get x(): number {
        lines.push("  x is read");
        return 5;
      },
      get y(): number {
        lines.push("  y is read");
        return 6;
      },
    }),
  ],
  ["an instance of a class", () => new Pixel(7, 8)],
  ["null", () => null],
  ["a number", () => 9],
  ["a point again", () => ({ x: 4, y: 5 })],
];
const meters: Row[] = [
  ["an instance", () => new Meter("m", 2)],
  ["an instance of a subclass", () => new Kilometer()],
  ["an object literal", () => ({ unit: "x", factor: 3 })],
  ["an object with the prototype alone", () => Object.create(Meter.prototype)],
  ["undefined", () => undefined],
  ["an instance again", () => new Meter("cm", 4)],
];
const texts: Row[] = [
  ["abc", () => "abc"],
  ["a number", () => 5],
  ["a String object", () => new String("abc")],
  ["an array", () => ["a"]],
  ["an object with the method", () => ({ toUpperCase: () => "OWN", length: 1 })],
  ["null", () => null],
  ["de", () => "de"],
];
const lists: Row[] = [
  ["three numbers", () => [1, 2, 3]],
  ["nothing", () => []],
  ["a fraction and a string", () => [1.5, "2"]],
  ["promises", () => [Promise.resolve(4), afterTwoJobs(5)]],
  ["a string", () => "12"],
  ["a set", () => new Set([4, 5])],
  ["what cannot be iterated", () => ({ length: 1 })],
  ["null", () => null],
  ["two numbers", () => [6, 7]],
];
const callbacks: Row[] = [
  ["a function", () => (n: number) => n * 2],
  ["a function that returns a string", () => (n: number) => "s" + n],
  ["an async function", () => async (n: number) => n],
  ["a function that throws", () => () => { throw new URIError("thrown by the callback"); }],
  ["null", () => null],
  ["a function again", () => (n: number) => n * 3],
];
const sources: Row[] = [
  ["the first class", () => new Quick(20)],
  ["the second class", () => new Patient(20)],
  ["a subclass", () => new Loud(20)],
  ["a method that returns a number", () => ({ read: (n: number) => n + 30 })],
  ["a method that returns a thenable", () => ({ read: (n: number) => thenableFor("the result", n + 40) })],
  ["the first class's method on another object", () => ({ base: "b", read: Quick.prototype.read })],
  ["the second class's method on another object", () => ({ base: 50, read: Patient.prototype.read })],
  ["no method", () => ({})],
  ["null", () => null],
  ["the second class again", () => new Patient(60)],
  ["the first class again", () => new Quick(60)],
];

// Each function awaits the same call twice: it has not been suspended before the first one, and a job has entered it before the second one.
const sites: [label: string, call: Call, rows: Row[]][] = [
  ["never awaits", async value => both(await neverAwaits(value), await neverAwaits(value)), numbers],
  ["awaits once", async value => both(await awaitsOnce(value), await awaitsOnce(value)), numbers],
  ["awaits odd numbers", async value => both(await awaitsOddNumbers(value), await awaitsOddNumbers(value)), numbers],
  ["returns its argument", async value => both(await returnsItsArgument(value), await returnsItsArgument(value)), resolutions],
  ["returns it later", async value => both(await returnsItLater(value), await returnsItLater(value)), resolutions],
  ["reads a record", async value => both(await readsARecord(value, 3), await readsARecord(value, 4)), points],
  ["reads a record, scaled by the value", async value => both(await readsARecord({ x: 1, y: 2 }, value), await readsARecord({ x: 3, y: 4 }, value)), numbers],
  ["reads an instance", async value => both(await readsAnInstance(value, 3), await readsAnInstance(value, 4)), meters],
  ["calls a string method", async value => both(await callsAStringMethod(value), await callsAStringMethod(value)), texts],
  ["calls it later", async value => both(await callsItLater(value), await callsItLater(value)), texts],
  ["sums an array", async value => both(await sumsAnArray(value), await sumsAnArray(value)), lists],
  ["has defaults", async value => both(await hasDefaults(value), await hasDefaults(value, value)), numbers],
  ["calls back", async value => both(await callsBack(value, 4), await callsBack(value, 5)), callbacks],
  ["takes a number or a string", async value => both(await takesEither(value), await takesEither(value)), numbers],
  ["calls typed functions", async value => both(await callsTypedFunctions(value), await callsTypedFunctions(value)), numbers],
  ["a method of either class", async value => both(await readsEither(value, 2), await readsEither(value, 3)), sources],
  ["a method of whatever comes", async value => both(await value.read(2), await value.read(3)), sources],
  ["a method of the first class", async value => both(await quick.read(value), await quick.read(value)), numbers],
  ["a method of the second class", async value => both(await patient.read(value), await patient.read(value)), numbers],
];

async function runSites(withTicks: boolean): Promise<void> {
  lines.push(withTicks ? "== beside other jobs" : "== alone");
  for (const [site, call, rows] of sites) {
    for (const [label, make] of rows) {
      const value = make();
      const stop = withTicks ? startTicks() : null;
      let outcome: string;
      try {
        outcome = await call(value);
      } catch (error) {
        outcome = "rejected with " + nameOf(error);
      }
      lines.push(site + ", " + label + ": " + outcome + (stop ? " after " + stop() + " ticks" : ""));
    }
  }
}

async function sumsReads(from: (Quick | Patient)[], rounds: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += await from[i % from.length].read(i);
  return sum;
}
async function sumsCalls(values: any[], rounds: number): Promise<string> {
  let sum = 0;
  let text = 0;
  for (let i = 0; i < rounds; i++) {
    const result: unknown = await awaitsOnce(values[i % values.length]);
    if (typeof result === "number") sum += result;
    else text += String(result).length;
  }
  return sum + " and " + text;
}

let opens: (() => void)[] = [];
function gate(): Promise<void> {
  return new Promise<void>(resolve => {
    opens.push(resolve);
  });
}
async function waitsAtTheGate(n: number): Promise<number> {
  await gate();
  return n;
}
async function callsWithItsType(n: number): Promise<number> {
  return 1 + (await waitsAtTheGate(n));
}
async function callsThroughAny(n: any): Promise<number> {
  return 1 + (await waitsAtTheGate(n));
}
class Near {
  async wait(n: number): Promise<number> {
    await gate();
    return n;
  }
}
class Far {
  async wait(n: number): Promise<number> {
    await gate();
    return -n;
  }
}
async function callsAMethod(where: Near | Far, n: number): Promise<number> {
  return 1 + (await where.wait(n));
}
const places: (Near | Far)[] = [new Near(), new Far()];

function livePromises(): number {
  if (!counted || typeof gc !== "function" || typeof memoryUsageStatistics !== "function") return 0;
  gc();
  return memoryUsageStatistics().objectTypeCounts.Promise ?? 0;
}
// A thousand chains of two functions, all suspended. An engine that makes a promise for every call holds three thousand.
async function census(label: string, start: (i: number) => Promise<number>): Promise<void> {
  const before = livePromises();
  const chains: Promise<number>[] = [];
  for (let i = 0; i < 1000; i++) chains.push(start(i));
  const held = livePromises() - before;
  for (const open of opens) open();
  opens = [];
  const values = await Promise.all(chains);
  lines.push(label + ": " + (held < 2500 ? "a chain holds the gate's promise and its own" : held + " PROMISES FOR 1000 CHAINS") + ", " + describe(values[0]) + " to " + describe(values[999]));
}
async function measure(label: string, calls: number, run: () => Promise<unknown>): Promise<void> {
  await null;
  const before = counted ? counted("operationAOTNewPromise") : 0;
  const result = await run();
  const entries = (counted ? counted("operationAOTNewPromise") : 0) - before;
  lines.push(label + ": " + describe(result) + ", " + (entries * 20 < calls ? "few entries" : entries + " ENTRIES FOR " + calls + " CALLS"));
}

for (const withTicks of [false, true, false, true]) await runSites(withTicks);
lines.push("== counts");
await census("arguments of the declared type", i => callsWithItsType(i));
await census("the declared type through any", i => callsThroughAny(i));
await census("another type through any", i => callsThroughAny("s" + i));
await census("both in turn", i => callsThroughAny(i % 2 ? i : "s" + i));
await census("methods of two classes", i => callsAMethod(places[i % 2], i));
await measure("methods of two classes in a loop", 20000, () => sumsReads([quick, patient], 20000));
await measure("methods of one class in a loop", 20000, () => sumsReads([patient], 20000));
await measure("numbers through any in a loop", 20000, () => sumsCalls([1, 2, 3], 20000));
await measure("numbers and strings through any in a loop", 20000, () => sumsCalls([1, "2", 3, "four"], 20000));
console.log(lines.join("\n"));

export {};
