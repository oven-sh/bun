// A function is handed something that can be walked and makes a list of it: the rest of a pattern, a spread, Array.from, a call with a spread.
// The list is used in the same function, often on a path that seldom runs. A program draws how the list is made, what is done with it, and
// whether the function first sees arrays alone two thousand times; then nineteen kinds of thing are handed in, each on both paths.
import type { Random } from "./random";

const takers = {
  "first-and-rest": "const [first, ...rest] = numbers; AFTER result.push(first, rest);",
  "two-and-rest": "const [a, b, ...rest] = numbers; AFTER result.push(a, b, rest);",
  "nested-rest": "const [first, ...[second, ...rest]] = numbers; AFTER result.push(first, second, rest);",
  "spread": "const rest = [...numbers]; AFTER result.push(rest);",
  "spread-twice": "const rest = [...numbers, 0, ...numbers]; AFTER result.push(rest);",
  "spread-into-a-call": "const rest = collect(...numbers); AFTER result.push(rest);",
  "array-from": "const rest = Array.from(numbers); AFTER result.push(rest);",
  "for-of-push": "const rest: number[] = []; for (const n of numbers) rest.push(n); AFTER result.push(rest);",
  "defaults": "const [a = -1, b = -2, ...rest] = numbers; AFTER result.push(a, b, rest);",
  "holes-in-the-pattern": "const [, , ...rest] = numbers; AFTER result.push(rest);",
  "assignment-pattern":
    "let first: number, rest: number[]; [first, ...rest] = numbers; AFTER result.push(first, rest);",
  "in-a-try":
    "let rest: number[] = []; try { [, ...rest] = numbers; } catch (e) { rest = [-9]; } AFTER result.push(rest);",
  "captured":
    "const [first, ...rest] = numbers; const read = () => rest.length; AFTER result.push(first, read(), rest);",
  "in-a-loop":
    "let rest: number[] = []; for (let i = 0; i < 3; i++) { const [, ...more] = numbers; if (i === 2) rest = more; } AFTER result.push(rest);",
  "on-a-rare-road": "let rest: number[] = [7]; if (rare) { [, ...rest] = numbers; } AFTER result.push(rest);",
  "either-road":
    "let rest: number[]; if (rare) { [, ...rest] = numbers; } else { rest = [...numbers]; } AFTER result.push(rest);",
  "rest-parameters":
    "const inner = (first: number, ...rest: number[]) => { AFTER return [first, rest]; }; result.push(inner(...(numbers as [number])));",
  "in-a-generator":
    "const steps = function* () { const [first, ...rest] = numbers; AFTER yield first; yield rest; }; result.push([...steps()]);",
  "slice-of-a-spread": "const rest = [...numbers].slice(1); AFTER result.push(rest);",
  "literal-with-elements": "const [a, b] = numbers; const rest = [a, b, 3]; AFTER result.push(rest);",
  "pair-swapped": "let [a, b] = numbers; [a, b] = [b, a]; const rest = [a, b]; AFTER result.push(rest);",
  "object-with-the-rest":
    "const [first, ...rest] = numbers; const holder = { first, rest }; AFTER result.push(holder.rest === rest, holder);",
};
const afterwards = {
  "nothing": "",
  "write-an-element": "rest[0] = 42;",
  "write-far": "rest[5] = 1;",
  "cut": "rest.length = 1;",
  "push": "rest.push(8);",
  "delete": "delete rest[0];",
  "kept": "kept.push(rest);",
  "rarely-kept": "if (rest.length === 4) kept.push(rest);",
  "rarely-written": "if (rare) rest[1] = 43;",
  "read-past-the-end": "total += rest[9] === undefined ? 1 : 0;",
  "frozen": "Object.freeze(rest);",
  "rarely-thrown": "if (rest.length === 4) throw new RangeError('four');",
  "read-then-rarely-cut": "total += rest.length; if (rare) rest.length = 0; total += rest.length;",
  "rarely-handed-on": "if (rare) touch(rest);",
};
const head = `function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value); if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) { const parts: string[] = []; for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole"); return "[" + parts.join(", ") + "]" + (Object.isFrozen(value) ? " frozen" : ""); }
  const parts: string[] = []; for (const [key, part] of Object.entries(value)) parts.push(key + ": " + show(part)); return "{" + parts.join(", ") + "}";
}
function attempt(label: string, run: () => unknown): void { let line: string; try { line = show(run()); } catch (error) { line = "threw " + (error instanceof Error ? error.constructor.name : show(error)); } console.log(label + ": " + line); }
const kept: number[][] = []; let total = 0;
function collect(...all: number[]): number[] { return all; }
function touch(list: number[]): void { list.reverse(); list.push(-1); }
class Countdown implements Iterable<number> { [Symbol.iterator](): Iterator<number> { return [3, 2, 1][Symbol.iterator](); } }
class Longer extends Array<number> { }
function* counted(): Generator<number> { yield 1; yield 2; yield 3; yield 4; yield 5; }
function given(...all: number[]): Iterable<number> { return arguments as unknown as Iterable<number>; }
const makers: [string, () => Iterable<number>][] = [
  ["an array", () => [3, 2, 1]], ["an array with a hole", () => [1, , 3] as number[]], ["doubles", () => [1.5, 2.5, 3.5, 4.5]], ["five", () => [1, 2, 3, 4, 5]], ["one", () => [1]], ["nothing", () => []],
  ["a countdown", () => new Countdown()], ["a set", () => new Set([4, 5])], ["keys of a map", () => new Map([[1, 2], [3, 4], [5, 6]]).keys()], ["a generator", () => counted()],
  ["a typed array", () => new Uint8Array([9, 8, 7])], ["arguments", () => given(6, 5, 4)], ["a subclass", () => Longer.from([1, 2, 3])], ["a frozen array", () => Object.freeze([1, 2, 3]) as number[]],
  ["an array with its own iterator", () => { const a = [1, 2, 3]; a[Symbol.iterator] = function* () { yield 30; yield 20; } as any; return a; }],
  ["an array with a getter", () => { const a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { return 77; } }); return a; }],
  ["texts in disguise", () => ["x", "y", "z"] as unknown as number[]], ["no iterable", () => 5 as unknown as number[]], ["undefined", () => undefined as unknown as number[]],
];`;
export function generate(random: Random): string {
  const body = random.pick(Object.values(takers)).replace("AFTER", random.pick(Object.values(afterwards)));
  const warmUp = random.chance(0.5)
    ? "for (let i = 0; i < 2000; i++) { try { taker([i, i + 1, i + 2], false); } catch { } }\nkept.length = 0; total = 0;\n"
    : "";
  return `${head}
function taker(numbers: Iterable<number>, rare: boolean): unknown {
  const result: unknown[] = [];
  { ${body} }
  return result;
}
${warmUp}for (const [name, make] of makers) { attempt(name, () => taker(make(), false)); attempt(name + ", rare", () => taker(make(), true)); }
console.log(show(kept.slice(0, 6)), kept.length, total);
export {};
`;
}
