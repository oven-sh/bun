// `function f(options: Options = {})`: some callers list every member, some leave the default. Reading the members of an object that was born empty costs about what reading a full one costs, not twice as much.
declare const console: { log(...values: unknown[]): void };
declare const performance: { now(): number };
interface Options { width?: number; height?: number; label?: string; next?: Options }
function withDefault(options: Options = {}): Options { return options; }
function measure(options: Options): number { return (options.width ?? 2) + (options.height ?? 3) + (options.label ? 1 : 0) + (options.next ? 1 : 0); }
const given: Options[] = [], left: Options[] = [];
for (let i = 0; i < 1000; i++) { given.push(withDefault({ width: i & 1, height: i & 3, label: "a" + i, next: undefined })); left.push(withDefault()); }
function sum(bags: Options[], rounds: number): number { let total = 0; for (let round = 0; round < rounds; round++) for (let i = 0; i < bags.length; i++) total += measure(bags[i]); return total; }
function fastestOf(runs: number, bags: Options[]): number {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) { const began = performance.now(); sum(bags, 4000); fastest = Math.min(fastest, performance.now() - began); }
  return fastest;
}
console.log(sum(given, 1), sum(left, 1));
const full = fastestOf(5, given), empty = fastestOf(5, left);
console.log(empty < full * 2 ? "the empty ones are read in under twice the time" : "the empty ones took over twice the time");
