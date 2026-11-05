// `return Math.max(...list)`: the answer for every kind of list, and who is on the stack when an element is converted.
const seen: string[] = [];
const say = (name: string, run: () => unknown) => {
  try { seen.push(name + ": " + String(run())); } catch (error) { seen.push(name + " threw " + (error as Error).constructor.name + " " + String((error as Error).message)); }
};
const frames = (error: Error) => (error.stack ?? "").split("\n").map(line => /at (?:async )?([\w.<>]+) \(/.exec(line)?.[1]).filter(name => name && !/^(say|module code|moduleEvaluation|asyncFunctionResume|loadAndEvaluateModule|promiseReactionJob\w*)$/.test(name)).join(" < ");

function largest(list: number[]): number { return Math.max(...list); }
function smallest(list: number[]): number { return Math.min(...list); }
function largestOfAnything(list: unknown[]): number { return Math.max(...(list as number[])); }
function largestNotLast(list: number[]): number { const most = Math.max(...list); return most + 1; }
function largestApplied(list: number[]): number { return Math.max.apply(null, list); }
function spanOf(list: number[]): number { return Math.max(...list) - Math.min(...list); }

const integers = [3, 9, -4], doubles = [0.5, -2.25, 8.75], holes = [1, , 3] as number[], zeros = [-0, 0], otherZeros = [0, -0];
const telling = { valueOf() { seen.push("converted under " + frames(new Error("valueOf"))); return 12; } };
const refusing = { valueOf() { throw new TypeError("no number"); } };
for (let round = 0; round < 3; round++) {
  for (const [name, list] of Object.entries({ integers, doubles, holes, zeros, otherZeros, none: [], one: [5], nan: [1, NaN, 3], infinite: [-Infinity, Infinity], large: [2 ** 31, 2 ** 53, -(2 ** 31)] }))
    say(name, () => [largest(list), smallest(list), largestNotLast(list), largestApplied(list), spanOf(list)].map(value => Object.is(value, -0) ? "-0" : String(value)).join());
  say("strings", () => largestOfAnything(["5", "11", " 7 "]));
  say("mixed", () => largestOfAnything([1, "2", true, null]));
  say("undefined", () => largestOfAnything([1, undefined]));
  say("object", () => largestOfAnything([1, telling, 3]));
  say("every element is converted", () => largestOfAnything([NaN, telling]));
  say("refusing", () => largestOfAnything([1, refusing]));
  say("frames of the error", () => { try { return largestOfAnything([refusing]); } catch (error) { return frames(error as Error); } });
  say("symbol", () => largestOfAnything([Symbol.iterator]));
  say("bigint", () => largestOfAnything([1n]));
}
const long = new Array<number>(50_000).fill(1); long[49_999] = 2;
say("fifty thousand", () => [largest(long), smallest(long)].join());
const tooLong = new Array<number>(10_000_000).fill(1);
say("ten million", () => largest(tooLong));
say("ten million, the smallest", () => smallest(tooLong));
say("ten million, not last", () => largestNotLast(tooLong));
say("ten million, applied", () => largestApplied(tooLong));
const withGetter = [1, 2, 3];
Object.defineProperty(withGetter, 1, { get() { seen.push("getter runs under " + frames(new Error("getter"))); return 20; } });
say("getter", () => largest(withGetter));
const ownIterator = [1, 2, 3];
(ownIterator as any)[Symbol.iterator] = function* () { yield 7; yield 8; };
say("iterator on the list", () => largest(ownIterator));
say("typed array", () => largest(new Float64Array([1.5, 2.5]) as unknown as number[]));
say("a set", () => largest(new Set([4, 6]) as unknown as number[]));
say("no list", () => largest(undefined as unknown as number[]));
let sum = 0;
for (let i = 0; i < 3000; i++) sum += largest(integers) + smallest(doubles) + largestOfAnything(integers);
say("sum", () => sum);
console.log(seen.join("\n"));
