declare const console: { log(...values: unknown[]): void };
function setAt(a: number[], i: number, x: number): number { a[i] = x; return a.length; }
function setTwo(a: number[], b: number[], i: number, x: number, y: number): void { a[i] = x * 0.5; b[i] = y + 0.25; }
function setHalf(a: number[], i: number, x: number): void { a[i] = x / 2; }
function setSquare(a: number[], i: number, x: number): void { a[i] = Math.sqrt(x); }
function appendOne(a: number[], x: number): void { a[a.length] = x; }
function show(a: unknown[]): string { let s = ""; for (let i = 0; i < a.length && i < 12; i++) s += (i in a ? Object.is(a[i], -0) ? "-0" : String(a[i]) : "_") + ","; return s + a.length; }
function tell(name: string, f: () => unknown): void { let said: string; try { said = String(f()); } catch (e) { said = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw"; } console.log(name + ": " + said); }
const kinds: [string, () => number[]][] = [
    ["doubles", () => [1.5, 2.5, 3.5]], ["whole", () => [1, 2, 3]], ["empty", () => []], ["values", () => { const a: unknown[] = [1.5, "x", 3]; a[1] = 2; return a as number[]; }],
    ["a hole", () => { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; }], ["new Array(3)", () => new Array<number>(3)], ["JSON", () => JSON.parse("[1,2.5,3]")],
    ["frozen", () => Object.freeze([1.5, 2.5]) as number[]], ["sealed", () => Object.seal([1.5, 2.5])], ["not extensible", () => Object.preventExtensions([1.5, 2.5])],
    ["sparse", () => { const a = [1.5]; a[150000] = 2; a.length = 3; return a; }], ["constants", () => [10, 20, 30, 40]],
];
const numbers = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 1e300, 5e-324];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        for (const x of numbers) {
            tell(name + " [1] = " + (Object.is(x, -0) ? "-0" : x), () => { const a = make(); const n = setAt(a, 1, x); return n + " " + show(a); });
            tell(name + " appended " + (Object.is(x, -0) ? "-0" : x), () => { const a = make(); appendOne(a, x); return show(a); });
        }
        for (const i of [0, 2, 3, 4, 9, 1000, -1, 4294967294, 4294967295]) tell(name + " set at " + i, () => { const a = make(); const n = setAt(a, i, 0.75); return n + " " + (a as unknown as Record<string, unknown>)[String(i)]; });
        tell(name + " halves and roots", () => { const a = make(); setHalf(a, 0, 3); setHalf(a, 1, 4); setSquare(a, 2, 16); setSquare(a, 0, -1); return show(a); });
        for (const [other, makeOther] of kinds) tell(name + " and " + other, () => { const a = make(), b = makeOther(); setTwo(a, b, 1, 3, 4); return show(a) + " " + show(b); });
    }
}
