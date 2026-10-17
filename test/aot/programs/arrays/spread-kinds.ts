// Spreads into array literals of numbers, of integers and of values, with elements before, between and behind them: sources of every length, however they keep their elements, with holes at the start, in the middle and at the end, with a property of their own, frozen, shared until written to.
declare const console: { log(...values: unknown[]): void };
function numbers(a: number[], b: number[], v: number): number[] { return [v, ...a, v, v, ...b, v]; }
function numbersFirst(a: number[], b: number[], v: number): number[] { return [...a, v, ...b]; }
function numbersOnly(a: number[], b: number[], c: number[]): number[] { return [...a, ...b, ...c]; }
function integers(a: number[], b: number[]): number[] { return [1, ...a, 2, 3, ...b, 4, 5, 6]; }
function values(a: unknown[], b: unknown[], v: unknown): unknown[] { return [v, ...a, v, v, ...b, v]; }
function texts(a: string[], b: string[]): string[] { return ["<", ...a, "|", ...b, ">", ">", ">", ">", ">"]; }
function mixed(a: number[], b: string[]): (number | string)[] { return ["n", ...a, 0.5, ...b, 1]; }
function inLoop(a: number[], b: number[]): number[] { let out: number[] = []; for (let i = 0; i < 3; i++) out = [i, ...a, i + 0.5, ...b, ...out.slice(0, 2), i]; return out; }
function textsInLoop(a: string[], b: string[]): string[] { let out: string[] = []; for (let i = 0; i < 3; i++) out = ["<", ...a, ...b, ...out.slice(0, 2), ">", ">"]; return out; }
function sum(...all: number[]): number { let t = 0; for (const x of all) t += x === undefined ? 1000 : x; return t; }
function passed(a: number[], b: number[]): number { return sum(1, ...a, 2, ...b, 3); }
function show(a: readonly unknown[]): string {
  let text = a.length + ":"; let run = 0;
  for (let i = 0; i < a.length; i++) { if (!(i in a)) text += "_"; else if (i < 6 || i > a.length - 7) text += String(a[i]) + ","; else run++; }
  let check = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; check = (check * 31 + (typeof v === "number" ? v * 2 : v === undefined ? 7 : String(v).length)) % 1000003; }
  return text + "(" + run + ")#" + check;
}
const lengths = [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 31, 63, 64, 65, 100, 127, 128, 200, 254, 255, 256, 300];
const kinds: [string, (n: number) => any[]][] = [
  ["int32s", n => Array.from({ length: n }, (_, i) => i + 1)],
  ["doubles", n => Array.from({ length: n }, (_, i) => i + 0.5)],
  ["values", n => Array.from({ length: n }, (_, i) => (i % 3 ? i : i + 0.25) as unknown).concat([]).map(x => x)],
  ["a hole first", n => { const a = Array.from({ length: n }, (_, i) => i + 0.5); delete a[0]; return a; }],
  ["a hole in the middle", n => { const a = Array.from({ length: n }, (_, i) => i + 0.5); delete a[n >> 1]; return a; }],
  ["a hole last", n => { const a = Array.from({ length: n }, (_, i) => i + 0.5); delete a[n - 1]; return a; }],
  ["a hole among int32s", n => { const a = Array.from({ length: n }, (_, i) => i + 1); delete a[n >> 1]; return a; }],
  ["only holes", n => new Array(n)],
  ["a property of its own", n => Object.assign(Array.from({ length: n }, (_, i) => i + 0.5), { extra: 1 })],
  ["frozen", n => Object.freeze(Array.from({ length: n }, (_, i) => i + 0.5)) as any[]],
  ["not a number among doubles", n => Array.from({ length: n }, (_, i) => (i === 1 ? NaN : i + 0.5))],
];
for (const [kind, make] of kinds) for (const n of lengths) {
  const a = make(n); const b = make(n >> 1);
  console.log(kind, n, show(numbers(a, b, 0.25)), show(numbersFirst(a, b, 9)), show(numbersOnly(a, b, a)), show(integers(a, b)), show(values(a, b, "v")), show(mixed(a, ["s", "t"])), show(inLoop(a, b)), n <= 100 ? passed(a, b) : "-");
}
for (const n of lengths) {
  const a = Array.from({ length: n }, (_, i) => "s" + i); const b = a.slice(n >> 1); const holey = a.slice(); delete holey[n >> 1];
  console.log("strings", n, show(texts(a, b)), show(texts(holey, a)), show(textsInLoop(a, b)), show(values(a, holey, 1)), show(mixed([1, 2.5], a)));
}
const literal = (): number[] => [1, 2, 3]; const halves = (): number[] => [0.5, 1.5];
console.log(show(numbers(literal(), halves(), 7)), show(integers(literal(), literal())), show(values(literal(), halves(), null)), show(numbersOnly(halves(), literal(), halves())));
