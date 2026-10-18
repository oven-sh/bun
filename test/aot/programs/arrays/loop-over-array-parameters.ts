// Loops over several array parameters: indexing type, butterfly and length checks are hoisted. Hoisting must not be observable: a null argument still throws at the same point, and not at all in a loop that runs zero times.
declare const console: { log(...v: unknown[]): void };
function weighted(values: number[], weights: number[]): number { let t = 0; for (let i = 0; i < values.length; i++) t += values[i]! * weights[i]!; return t; }
function steps(heights: number[], widths: number[]): number { let t = 0; for (let i = 0; i + 1 < heights.length; i++) t += Math.abs(heights[i + 1]! - heights[i]!) * (widths[i]! + widths[i + 1]!); return t; }
function threeLists(a: number[], b: number[], c: number[], n: number): number { let t = 0; for (let i = 0; i < n; i++) t += (a[i] ?? 1) + (b[i] ?? 10) * (c[i] ?? 100); return t; }
function behind(list: number[]): number { let t = 0; for (let i = 1; i < list.length; i++) t += list[i]! - list[i - 1]! * 0.5; return t; }
function behindFromZero(list: number[]): string { let out = ""; for (let i = 0; i < list.length; i++) out += (list[i - 1] ?? "none") + ";"; return out; }
function copies(from: number[], to: number[]): number { for (let i = 0; i < from.length; i++) to[i] = from[i]! + 1; return to.length; }
function notes(trail: string[], first: number[], second: number[]): number { let t = 0; for (let i = 0; i < first.length; i++) { trail.push("turn " + i); t += first[i]! + second[i]!; } return t; }
function words(names: string[], marks: number[]): string { let out = ""; for (let i = 0; i < names.length; i++) out += names[i]! + marks[i]! + " "; return out; }
function seldomChanges(a: number[], b: number[], at: number, act: () => void): string { let out = ""; for (let i = 0; i < a.length; i++) { if (i === at) act(); out += a[i] + "/" + b[i] + " "; } return out; }
function said(run: () => unknown): string { try { return String(run()); } catch (e) { return (e as Error).constructor.name; } }
class Listing extends Array<number> {}

const long: number[] = []; for (let i = 0; i < 50; i++) long.push(i * 1.5);
const whole: number[] = []; for (let i = 0; i < 50; i++) whole.push(50 - i);
const short: number[] = [2, 4, 6];
const nothing = null as unknown as number[];
const missing = undefined as unknown as number[];
const out: unknown[] = [];
for (let r = 0; r < 3; r++) {
  out.push(weighted(long, whole), weighted(whole, long), weighted(short, long), Number.isNaN(weighted(long, short)), weighted([], long), weighted([], nothing));
  out.push(steps(long, whole), steps(whole, long), steps(short, long), Number.isNaN(steps(long, short)), steps([1], nothing), steps([], missing));
  out.push(threeLists(long, whole, short, 50), threeLists(short, short, short, 5), threeLists(long, whole, long, 0), threeLists(long, whole, long, -1), threeLists(long, whole, long, 2.5));
  out.push(behind(long), behind(whole), behind([7]), behind([]), behindFromZero(short), behindFromZero([]));
  out.push(said(() => weighted(long, nothing)), said(() => weighted(nothing, long)), said(() => steps(long, missing)), said(() => threeLists(long, nothing, short, 2)), said(() => threeLists(long, nothing, short, 0)));
  const trail: string[] = []; out.push(said(() => notes(trail, short, nothing)), trail.join(), said(() => notes(trail, [], nothing)), trail.length);
  const target: number[] = []; out.push(copies(short, target), target.join(), copies(long, target), target[49], copies(short, short), short.join()); short[0] = 2; short[1] = 4; short[2] = 6;
  out.push(words(["a", "b", "c"], short), words(["a", "b", "c", "d"], short), words([], nothing));
}
{ const a = [1.5, 2.5, 3.5, 4.5], b = [1, 2, 3, 4]; out.push(seldomChanges(a, b, 2, () => { b.length = 1; })); }
{ const a = [1.5, 2.5, 3.5, 4.5], b = [1, 2, 3, 4]; out.push(seldomChanges(a, b, 1, () => { b[2] = 2.25; })); }
{ const a = [1.5, 2.5, 3.5, 4.5], b = [1, 2, 3, 4]; out.push(seldomChanges(a, b, 1, () => { a.push(9, 10); b[7] = 8; })); }
{ const a = [1.5, 2.5, 3.5, 4.5], b = [1, 2, 3, 4]; out.push(seldomChanges(a, b, 3, () => { a.length = 0; })); }
{ const a = [1.5, 2.5, 3.5], b = [1, 2, 3]; delete b[1]; out.push(seldomChanges(a, b, 9, () => {}), weighted(a, Object.freeze([3, 2, 1]) as number[])); }
{ const a = new Listing(); a.push(1, 2, 3); out.push(weighted(a, short), weighted(short, a), steps(a, a)); }
{ const a = [1, 2, 3]; const inherits: number[] = [5, 6, 7]; delete inherits[1]; const parent: Record<number, number> = Object.create(Array.prototype); parent[1] = 60; Object.setPrototypeOf(inherits, parent); out.push(weighted(a, inherits), threeLists(a, inherits, a, 3)); delete parent[1]; out.push(Number.isNaN(weighted(a, inherits))); }
console.log(out.join(" "));
