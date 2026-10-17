declare const console: { log(...values: unknown[]): void };
function show(v: number): string { return Object.is(v, -0) ? "-0" : String(v); }
function each(a: number[], f: (a: number[], i: number) => number): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(f(a, i)) + " "; return s; }
function sumSqrt(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += Math.sqrt(x); } return t; }
function sumFloor(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += Math.floor(a[i]); return t; }
function sumAbs(a: number[]): number { let t = 0; for (const x of a) t += Math.abs(x); return t; }
function sumMax(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += Math.max(a[i], 2); return t; }
function sumImul(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += Math.imul(a[i], 3); return t; }
function bumpAll(a: number[]): string { for (let i = 0; i < a.length; i++) a[i]++; let s = ""; for (let i = 0; i < a.length; i++) s += show(a[i]) + ","; return s; }
function dropAll(a: number[]): string { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]--; return show(t) + " " + a.map(show).join(); }
function keptToo(a: number[]): string { let t = 0, n = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += Math.sqrt(x); if (x === undefined) n++; } return show(t) + " " + n; }
const unary: [string, (a: number[], i: number) => number][] = [
    ["abs", (a, i) => Math.abs(a[i])], ["floor", (a, i) => Math.floor(a[i])], ["ceil", (a, i) => Math.ceil(a[i])], ["trunc", (a, i) => Math.trunc(a[i])], ["round", (a, i) => Math.round(a[i])],
    ["fround", (a, i) => Math.fround(a[i])], ["sqrt", (a, i) => Math.sqrt(a[i])], ["clz32", (a, i) => Math.clz32(a[i])], ["sign", (a, i) => Math.sign(a[i])], ["sin", (a, i) => Math.sin(a[i])],
    ["exp", (a, i) => Math.exp(a[i])], ["log", (a, i) => Math.log(a[i])], ["cbrt", (a, i) => Math.cbrt(a[i])], ["imul", (a, i) => Math.imul(a[i], a[i + 1])], ["atan2", (a, i) => Math.atan2(a[i], a[i + 1])],
    ["hypot1", (a, i) => Math.hypot(a[i])], ["hypot2", (a, i) => Math.hypot(a[i], a[i + 1])], ["hypot3", (a, i) => Math.hypot(a[i], a[i + 1], 2)], ["max", (a, i) => Math.max(a[i], a[i + 1])], ["min", (a, i) => Math.min(a[i], 1)],
    ["pow", (a, i) => Math.pow(a[i], 2)], ["floor | 0", (a, i) => Math.floor(a[i]) | 0], ["sqrt + 1", (a, i) => Math.sqrt(a[i]) + 1],
];
const arrays: [string, () => number[]][] = [
    ["doubles", () => [1.5, -2.5, 4, -0, 0, 1e300, -1e300, Infinity, -Infinity, 0.49999999999999994]],
    ["with NaN", () => [1.5, NaN, 9]],
    ["with a hole", () => { const a = [1.5, 2.25, 16]; delete (a as unknown[])[1]; return a; }],
    ["all holes", () => new Array<number>(3)],
    ["with undefined", () => [4, undefined as unknown as number, 9]],
    ["parsed", () => JSON.parse("[4,9,-16,2147483647,-2147483648]") as number[]],
    ["empty", () => []],
];
const table: { [name: string]: number } = { a: 6.25, b: -2.5 };
function ofTable(name: string): string { return [Math.sqrt(table[name]), Math.floor(table[name]), Math.abs(table[name]), Math.sign(table[name]), Math.clz32(table[name]), Math.hypot(table[name], 3), Math.max(table[name], 1)].map(show).join(" "); }
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of arrays) {
        console.log(name + ": " + [sumSqrt(make()), sumFloor(make()), sumAbs(make()), sumMax(make()), sumImul(make())].map(show).join(" ") + " | " + keptToo(make()) + " | " + bumpAll(make()) + " | " + dropAll(make()));
        for (const [which, f] of unary)
            console.log("  " + which + ": " + each(make(), f));
    }
    for (const name of ["a", "b", "c"])
        console.log(ofTable(name));
}
