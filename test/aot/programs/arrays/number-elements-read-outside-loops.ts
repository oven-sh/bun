declare const console: { log(...values: unknown[]): void };
function at(a: number[], i: number): number { return a[i]; }
function sumOfThree(a: number[], i: number, j: number, k: number): number { return a[i] + a[j] + a[k]; }
function orZero(a: number[], i: number): number { return a[i] ?? 0; }
function isThere(a: number[], i: number): boolean { return a[i] !== undefined; }
function text(a: number[], i: number): string { return "<" + a[i] + ">"; }
function first(a: number[]): number { return a[0]; }
function last(a: number[]): number { return a[a.length - 1]; }
function twice(a: number[], b: number[], i: number): number { const x = a[i]; const y = b[i]; return x * 2 + y; }
function show(x: unknown): string { return Object.is(x, -0) ? "-0" : String(x); }
function tell(name: string, f: () => unknown): void { let said: string; try { said = show(f()); } catch (e) { said = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw"; } console.log(name + ": " + said); }
const kinds: [string, () => number[]][] = [
    ["doubles", () => [1.5, 2.5, 3.5]], ["whole", () => [1, 2, 3]], ["empty", () => []], ["values", () => { const a: unknown[] = [1.5, "x", 3]; a[1] = 2; return a as number[]; }],
    ["odd numbers", () => [NaN, -0, 0, Infinity, -Infinity, 1e300, 5e-324, 4294967296, -2147483649]],
    ["odd numbers among values", () => { const a: unknown[] = ["x", NaN, -0, 1e300, 2147483648]; a[0] = -0; return a as number[]; }],
    ["a hole", () => { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; }], ["a hole among whole numbers", () => { const a = [1, 2, 3]; delete (a as unknown[])[1]; return a; }],
    ["new Array(3)", () => new Array<number>(3)], ["JSON", () => JSON.parse("[1,2.5,3]")], ["undefined inside", () => [1.5, undefined, 3.5] as number[]],
    ["frozen", () => Object.freeze([1.5, 2.5]) as number[]], ["sparse", () => { const a = [1.5]; a[150000] = 2; return a; }], ["constants", () => [10, 20, 30, 40]],
    ["a property -1", () => { const a = [1.5, 2.5]; (a as unknown as Record<string, number>)["-1"] = 7; return a; }],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        for (const i of [0, 1, 2, 3, 8, -1, 150000, 4294967294, 4294967295, 4294967296]) {
            tell(name + " at " + i, () => at(make(), i));
            tell(name + " or zero at " + i, () => orZero(make(), i));
            tell(name + " is there at " + i, () => isThere(make(), i));
            tell(name + " as text at " + i, () => text(make(), i));
        }
        tell(name + " sum", () => sumOfThree(make(), 0, 1, 2));
        tell(name + " first and last", () => show(first(make())) + " " + show(last(make())));
        for (const [other, makeOther] of kinds) tell(name + " twice and " + other, () => twice(make(), makeOther(), 1));
    }
}
