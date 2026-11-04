// `return f(...list)` where f is one known function: what f gets for every kind of list, who is on the stack while f runs, and that the caller's frame is gone.
const seen: string[] = [];
const say = (name: string, run: () => unknown) => {
  try { seen.push(name + ": " + String(run())); } catch (error) { seen.push(name + " threw " + (error as Error).constructor.name + " " + String((error as Error).message)); }
};
const frames = (error: Error) => (error.stack ?? "").split("\n").map(line => /at (?:async )?([\w.<>]+) \(/.exec(line)?.[1]).filter(name => name && !/^(say|module code|moduleEvaluation|asyncFunctionResume|loadAndEvaluateModule|promiseReactionJob\w*)$/.test(name)).join(" < ");

function add(first: number, second: number, third: number): number { return first + second + third; }
function addAll(values: number[]): number { return add(...(values as [number, number, number])); }
function describe(first?: unknown, second: unknown = "default", third?: unknown): string { return [typeof first, String(first), String(second), String(third)].join(); }
function describeAll(values: unknown[]): string { return describe(...values); }
function counts(first?: unknown): number { return arguments.length; }
function countAll(values: unknown[]): number { return counts(...values); }
function gathers(first?: unknown, ...others: unknown[]): string { return String(first) + "|" + others.join(); }
function gatherAll(values: unknown[]): string { return gathers(...values); }
function whoCalls(first?: unknown, second?: unknown): string { return frames(new Error("here")); }
function whoCallsAll(values: unknown[]): string { return whoCalls(...values); }
function refuses(first: number, second: number): number { if (first > second) throw new RangeError("first " + first + " over " + second); return second - first; }
function refusesAll(values: number[]): number { return refuses(...(values as [number, number])); }
function forward(...values: [number, number, number]): number { return add(...values); }
function notLast(values: number[]): number { const sum = add(...(values as [number, number, number])); return sum + 1; }
function inTry(values: number[]): number { try { return refuses(...(values as [number, number])); } catch (error) { return -1; } }
function countDown(left: number, sum: number): number { if (!left) return sum; const next = [left - 1, sum + left]; return countDown(...(next as [number, number])); }
class Counter {
  total = 0;
  bump(by: number, times: number): number { this.total += by * times; return this.total; }
  bumpAll(values: number[]): number { return this.bump(...(values as [number, number])); }
}

const holes = [1, , 3] as number[];
const grown: number[] = []; grown[2] = 5;
const mixed: unknown[] = [1, "two", { toString() { return "three"; } }];
const doubles = [0.5, 1.5, 2.5], integers = [1, 2, 3];
for (let round = 0; round < 3; round++) {
  say("three", () => addAll(integers));
  say("doubles", () => addAll(doubles));
  say("none", () => addAll([]));
  say("two", () => addAll([1, 2]));
  say("five", () => addAll([1, 2, 3, 4, 5]));
  say("holes", () => addAll(holes));
  say("grown", () => addAll(grown));
  say("ill-typed", () => addAll(mixed as number[]));
  say("describe none", () => describeAll([]));
  say("describe undefined", () => describeAll([undefined, undefined, undefined]));
  say("describe holes", () => describeAll(holes));
  say("describe mixed", () => describeAll(mixed));
  say("count", () => [countAll([]), countAll([1]), countAll(holes), countAll(new Array(7))].join());
  say("gather", () => [gatherAll([]), gatherAll([1]), gatherAll([1, 2, 3])].join(" "));
  say("stack", () => whoCallsAll([1, 2]));
  say("stack of none", () => whoCallsAll([]));
  say("refuses", () => refusesAll([1, 2]));
  say("refuses", () => refusesAll([2, 1]));
  say("frames of the error", () => { try { return refusesAll([3, 1]); } catch (error) { return frames(error as Error); } });
  say("forward", () => forward(1, 2, 3));
  say("not last", () => notLast(integers));
  say("in try", () => [inTry([1, 2]), inTry([2, 1])].join());
  say("method", () => { const counter = new Counter(); return [counter.bumpAll([2, 3]), counter.bumpAll([1]), counter.total].join(); });
}
say("a million deep", () => countDown(1_000_000, 0));
say("too long", () => addAll(new Array(10_000_000).fill(1)));
say("too long, described", () => describeAll(new Array(10_000_000)));

// A list that is no longer as it was made.
const withGetter = [1, 2, 3];
Object.defineProperty(withGetter, 1, { get() { seen.push("getter runs under " + frames(new Error("getter"))); return 20; } });
say("getter", () => addAll(withGetter));
const frozen = Object.freeze([4, 5, 6]) as number[];
say("frozen", () => addAll(frozen));
class Doubled extends Array<number> { *[Symbol.iterator](): ArrayIterator<number> { for (let index = 0; index < this.length; index++) yield this[index] * 2; } }
say("own iterator", () => addAll(Doubled.from([1, 2, 3]) as number[]));
const ownIterator = [1, 2, 3];
(ownIterator as any)[Symbol.iterator] = function* () { yield 7; yield 8; yield 9; };
say("iterator on the list", () => addAll(ownIterator));
say("no list", () => addAll(null as unknown as number[]));
say("a string", () => describeAll("abc" as unknown as unknown[]));
say("a set", () => describeAll(new Set([1, 2]) as unknown as unknown[]));
for (let i = 0; i < 3000; i++) { addAll(integers); addAll(doubles); describeAll(mixed); forward(i, i, i); }
console.log(seen.join("\n"));
