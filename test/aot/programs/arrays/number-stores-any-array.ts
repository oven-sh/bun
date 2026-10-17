declare const console: { log(...values: unknown[]): void };
let depth = 0;
function put(a: number[], i: number, v: number): void { if (depth > 0) { depth--; put(a, i, v); } a[i | 0] = v * 0.5; }
function putThird(a: number[], v: number): void { if (depth > 0) { depth--; putThird(a, v); } a[2] = v + 0.25; }
function fillUp(a: number[], n: number, v: number): void { if (depth > 0) { depth--; fillUp(a, n, v); } for (let i = 0; i < n; i++) a[i] = v * i; }
function scale(a: number[], k: number): void { if (depth > 0) { depth--; scale(a, k); } for (let i = 0; i < a.length; i++) a[i] = a[i] * k; }
function show(a: readonly unknown[]): string { let text = a.length + ":"; for (let i = 0; i < Math.min(a.length, 9); i++) text += (i in a ? (Object.is(a[i], -0) ? "-0" : String(a[i])) : "hole") + ","; return text; }
function attempt(name: string, a: number[], action: () => void): void { try { action(); console.log(name, show(a)); } catch (error) { console.log(name, "throws", error instanceof TypeError ? "TypeError" : String(error), show(a)); } }
const makers: [string, () => number[]][] = [
    ["doubles", () => [0.5, 1.5, 2.5, 3.5]], ["integers", () => [1, 2, 3, 4]], ["empty", () => []], ["pushed", () => { const a: number[] = []; a.push(1.5); a.push(2); return a; }],
    ["holes", () => [1.5, , 3.5] as number[]], ["made", () => new Array<number>(4)], ["asValues", () => { const a: number[] = [1, 2.5, 3]; (a as unknown[]).push("x"); a.pop(); return a; }],
    ["outside", () => JSON.parse("[1,2,3,4.5]") as number[]], ["outsideIntegers", () => JSON.parse("[7,8,9]") as number[]], ["frozen", () => Object.freeze([1.5, 2.5, 3.5]) as number[]], ["sealed", () => Object.seal([1.5, 2.5, 3.5]) as number[]],
    ["sparse", () => { const a: number[] = []; a[3000] = 4.5; return a; }], ["mapped", () => [1, 2, 3].map(v => v * 0.5)], ["filled", () => new Array<number>(3).fill(2.5)], ["shrunk", () => { const a = [1.5, 2.5, 3.5, 4.5]; a.length = 2; return a; }],
];
for (let round = 0; round < 2; round++) {
    for (const [name, make] of makers) {
        for (const i of [0, 2, 3, 4, 5, 9, -1]) { const a = make(); attempt(name + " put " + i, a, () => put(a, i, 7)); }
        for (const v of [NaN, Infinity, -0, 1e300, 3]) { const a = make(); attempt(name + " value " + v, a, () => { put(a, 1, v); putThird(a, v); }); }
        { const a = make(); attempt(name + " fillUp", a, () => fillUp(a, 7, 1.5)); }
        { const a = make(); if (name !== "sparse") attempt(name + " scale", a, () => scale(a, 0.5)); }
    }
}
