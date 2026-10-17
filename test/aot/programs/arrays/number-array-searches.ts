declare const console: { log(...values: unknown[]): void };
let depth = 0;
function indexOfNumber(a: number[], x: number): number { if (depth > 0) { depth--; indexOfNumber(a, x); } for (let i = 0; i < a.length; i++) if (a[i] === x) return i; return -1; }
function lastNot(a: readonly number[], x: number): number { if (depth > 0) { depth--; lastNot(a, x); } for (let i = a.length - 1; i >= 0; i--) if (a[i] !== x) return i; return -1; }
function countLoose(a: (number | undefined)[], x: number | undefined): number { if (depth > 0) { depth--; countLoose(a, x); } let count = 0; for (let i = 0; i < a.length; i++) if (a[i] == x) count++; return count; }
function countOf(a: number[], x: unknown): number { if (depth > 0) { depth--; countOf(a, x); } let count = 0; for (const value of a) if (value === x) count++; return count; }
function kinds(a: (number | string)[]): string { if (depth > 0) { depth--; kinds(a); } let text = ""; for (let i = 0; i < a.length; i++) text += typeof a[i] === "number" ? "n" : "s"; return text; }
function firstSame(a: number[], b: number[]): number { if (depth > 0) { depth--; firstSame(a, b); } for (let i = 0; i < a.length; i++) if (a[i] === b[i]) return i; return -1; }
const integers = [3, 1, 4, 1, 5, 9, 2, 6];
const doubles = [0.5, 1.5, -0, 0, NaN, Infinity, 2.5, 1e300];
const mixed: number[] = [1, 2, 3]; mixed.push(0.25);
const asValues: number[] = [1, 2.5]; (asValues as unknown[]).push("x"); asValues.pop();
const holes: number[] = [1, , 3] as number[];
const doubleHoles: number[] = [0.5, , 2.5] as number[];
const frozen = Object.freeze([7, 8, 9]) as number[];
const sparse: number[] = []; sparse[3000] = 4;
class Numbers extends Array<number> {}
const derived = new Numbers(); derived.push(1, 2, 3);
const grown: number[] = []; for (let i = 0; i < 100; i++) grown.push(i * (i % 3 === 0 ? 1 : 0.5));
const all = [integers, doubles, mixed, asValues, holes, doubleHoles, frozen, sparse, derived, grown, [] as number[]];
const needles = [1, 3, 0, -0, 0.5, 2.5, NaN, Infinity, 9, 4, 49.5, 99, 1e300, -1];
for (let round = 0; round < 2; round++) {
    for (const a of all) {
        const row: (number | string)[] = [];
        for (const x of needles) row.push(indexOfNumber(a, x), lastNot(a, x), countOf(a, x), countLoose(a, x));
        row.push(countLoose(a, undefined), countOf(a, undefined), countOf(a, "1"), firstSame(a, integers), firstSame(a, doubles), firstSame(doubles, a));
        console.log(row.join(" "));
    }
    console.log(kinds([1, "a", 2.5, "b"]), kinds([1, 2]), kinds([0.5]), kinds(["x"]), kinds([]));
}
