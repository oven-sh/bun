// An array element read that may be out of bounds returns `undefined`, whatever the static type says (as under `noUncheckedIndexedAccess`).
type Kind = "a" | "b" | "c" | "z";
interface Config { sort: string; weight: number; on: boolean; inner: { depth: number } }
const config = (sort: string): Config => ({ sort, weight: 1, on: true, inner: { depth: 1 } });
const table: Record<Kind, Config> = { a: config("a"), b: config("b"), c: config("c") } as Record<Kind, Config>;
// A kind that the table does not hold, as it comes out of a file or off the wire.
const z = JSON.parse('"z"') as Kind;
const weights: Record<string, number> = { a: 1 }, flags: { [k: string]: boolean } = { a: true }, names: Record<string, string> = { a: "A" };
const numbers: number[] = [1, 2], booleans: boolean[] = [true], strings: string[] = ["s"], records: Config[] = [];
const show = (...all: unknown[]) => console.log(all.map(v => typeof v === "number" && v !== v ? "NaN" : String(v)).join(" "));
// The application's form.
function isA(kind: Kind | null): boolean { if (!kind) return false; const config = table[kind]; return config && config.sort === "a"; }
show("isA", isA("a"), isA("b"), isA(z), isA(null), isA(z) ? "yes" : "no", !isA(z), isA(z) === false);
// A declared result.
function weightOf(k: string): number { return weights[k]; }
function flagOf(k: string): boolean { return flags[k]; }
function nameOf(k: string): string { return names[k]; }
function recordOf(i: number): Config { return records[i]; }
show("results", weightOf("a"), weightOf("z"), flagOf("a"), flagOf("z"), nameOf("z"), recordOf(3), weightOf("z") + 1, typeof weightOf("z"), typeof flagOf("z"));
// An inferred result, a const, a let, annotated or not.
function inferred(k: string) { return weights[k]; }
function locals(k: string, i: number) { const a = weights[k]; const b: number = weights[k]; let c = numbers[i]; let d: boolean = booleans[i]; c = numbers[i + 1]; return [a, b, c, d, a + b, typeof d].join(); }
show("locals", inferred("z"), locals("z", 5), locals("a", 0));
// The operators.
let steps = 0;
function operators(k: string, i: number) {
  const and: number = weights[k] && 5, or: number = weights[k] || 7, nullish: number = weights[k] ?? 9, cond: number = i > 0 ? weights[k] : numbers[i + 9], comma: number = (steps++, numbers[9]);
  const both: boolean = flags[k] && flags[k + k], either: boolean = flags[k] || flags[k + k];
  return [and, or, nullish, cond, comma, both, either].join();
}
show("operators", operators("z", 1), operators("a", 0));
// A parameter, with and without a default; a callback's.
function double(n: number): number { return n * 2; }
function orTen(n: number = 10): number { return n; }
function not(b: boolean): boolean { return !b; }
function passOn(n: number): number { return double(n); }
show("parameters", double(weights["z"]), double(numbers[7]), orTen(numbers[7]), not(flags["z"]), passOn(weights["z"]));
// A test catches it: after the test the value has its declared type.
function tested(k: string): number { const w = weights[k]; if (w === undefined) return -1; const n: number = w; return n + 1; }
function truthy(k: string): number { const w = weights[k]; return w ? w * 2 : -2; }
function guarded(k: string): boolean { const f = flags[k]; return typeof f === "boolean" && f; }
function later(k: string): () => number { const w = weights[k]; if (!w) return () => -3; return () => w; }
show("tested", tested("a"), tested("z"), truthy("a"), truthy("z"), guarded("a"), guarded("z"), later("a")(), later("z")());
// A read that is proven to be in bounds is unchanged.
function sum(a: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) { const n: number = a[i]; s += n; } for (let i = a.length - 1; i >= 0; i--) s += a[i]; for (const n of a) s += n; return s; }
show("hits", sum(numbers), sum([]));
// Holes, negative and fractional indices, a tuple, a string.
const holes: number[] = [1, 2, 3]; delete holes[1]; const pair: [number, boolean] = [1, true]; const at: number = -1;
function odd() { const h: number = holes[1], n: number = numbers[at], f: number = numbers[0.5], p: number = pair[0], q: boolean = pair[1], ch: string = "abc"[7]; return [h, n, f, p, q, ch].join(); }
show("odd", odd());
