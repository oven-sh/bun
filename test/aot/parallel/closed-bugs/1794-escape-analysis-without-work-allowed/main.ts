// Flags: --aot-limit=MaxEscapeAnalysisWork:0 --aot-validate
function show(value: unknown): string {
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
];
function taker(numbers: Iterable<number>, rare: boolean): unknown {
  const result: unknown[] = [];
  { let rest: number[] = []; try { [, ...rest] = numbers; } catch (e) { rest = [-9]; } if (rest.length === 4) throw new RangeError('four'); result.push(rest); }
  return result;
}
for (const [name, make] of makers) { attempt(name, () => taker(make(), false)); attempt(name + ", rare", () => taker(make(), true)); }
console.log(show(kept.slice(0, 6)), kept.length, total);
export {};
