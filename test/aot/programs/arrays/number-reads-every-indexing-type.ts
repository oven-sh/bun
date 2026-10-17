declare const console: { log(...values: unknown[]): void };
let depth = 0;
function at(a: number[], i: number): number | undefined { if (depth > 0) { depth--; at(a, i); } return a[i | 0]; }
function third(a: number[]): number { if (depth > 0) { depth--; third(a); } return a[2]; }
function sum(a: readonly number[]): number { if (depth > 0) { depth--; sum(a); } let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
function sumPast(a: number[], n: number): number { if (depth > 0) { depth--; sumPast(a, n); } let t = 0; for (let i = 0; i < n; i++) { const v = a[i]; t += v === undefined ? 1000 : v; } return t; }
function last(a: number[]): number | undefined { if (depth > 0) { depth--; last(a); } return a[a.length - 1]; }
function show(v: number | undefined): string { return v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : String(v); }
const doubles = [0.5, 1.5, -0, 2.5]; const integers = [1, 2, 3, 4]; const constants: number[] = [10, 20, 30];
const pushed: number[] = []; for (let i = 0; i < 6; i++) pushed.push(i % 2 ? i : i + 0.25);
const withNaN: number[] = [1.5, 2.5, 3.5]; withNaN[1] = NaN;
const holes = [1.5, , 3.5] as number[]; const integerHoles = [1, , 3] as number[]; const made = new Array<number>(4); made[2] = 7.5;
const asValues: number[] = [1, 2.5, 3]; (asValues as unknown[]).push("x"); asValues.pop();
const outside = JSON.parse("[1,2,3,4.5]") as number[]; const outsideIntegers = JSON.parse("[7,8,9]") as number[];
const frozen = Object.freeze([1.5, 2.5, 3.5]) as number[]; const sparse: number[] = []; sparse[3000] = 4.5; sparse[2] = 1.5;
class Numbers extends Array<number> {} const derived = new Numbers(); derived.push(1.5, 2.5, 3.5);
const mapped = integers.map(v => v * 0.5); const sliced = doubles.slice(1); const filled = new Array<number>(3).fill(2.5); const spread = [...integers, 0.5]; const from = Array.from({ length: 3 }, (_, i) => i * 1.5);
const shrunk = [1.5, 2.5, 3.5, 4.5]; shrunk.length = 2; const grownByLength = [1.5]; grownByLength.length = 3;
const all: [string, number[]][] = [["doubles", doubles], ["integers", integers], ["constants", constants], ["pushed", pushed], ["withNaN", withNaN], ["holes", holes], ["integerHoles", integerHoles], ["made", made], ["asValues", asValues], ["outside", outside], ["outsideIntegers", outsideIntegers], ["frozen", frozen], ["sparse", sparse], ["derived", derived], ["mapped", mapped], ["sliced", sliced], ["filled", filled], ["spread", spread], ["from", from], ["shrunk", shrunk], ["grownByLength", grownByLength], ["empty", []]];
for (let round = 0; round < 2; round++) {
    for (const [name, a] of all) console.log(name, [0, 1, 2, 3, 4, -1, 3000, 4294967295].map(i => show(at(a, i))).join(" "), show(third(a)), name === "sparse" ? "-" : show(sum(a)), show(sumPast(a, 6)), show(last(a)));
}
outsideIntegers[1] = 0.5; integers[0] = 1e300; console.log(show(sum(outsideIntegers)), show(sum(integers)), show(third(outsideIntegers)));
