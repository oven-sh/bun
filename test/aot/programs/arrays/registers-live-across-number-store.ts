declare const console: { log(...values: unknown[]): void };
function amongValues(): unknown[] { const a: unknown[] = ["x", 1.5]; a[0] = 2.5; return a; }
function minusZero(): unknown[] { const a: unknown[] = ["x", NaN, -0, 1e300, 2147483648]; a[0] = -0; return a; }
function whole(): unknown[] { const a: unknown[] = ["x", 1.5]; a[0] = 7; return a; }
function notANumber(): unknown[] { const a: unknown[] = ["x", 1.5]; a[1] = NaN; return a; }
function cast(): number[] { const a: unknown[] = ["x", NaN, -0, 1e300, 2147483648]; a[0] = -0; return a as number[]; }
function twoStores(): unknown[] { const a: unknown[] = ["x", "y", "z"], b: unknown[] = ["p"]; a[0] = 0.25; b[0] = 0.75; a[2] = 1e300; return [a, b]; }
function four(a: unknown[], b: unknown[], c: unknown[], d: unknown[], x: number): unknown[][] { a[0] = x; b[0] = x + 0.5; c[0] = x * 2; d[0] = x / 4; return [a, b, c, d]; }
function fourOfNumbers(a: number[], b: number[], c: number[], d: number[], x: number): number[][] { a[0] = x; b[0] = x + 0.5; c[0] = x * 2; d[0] = x / 4; return [a, b, c, d]; }
function many(a: unknown[], s: string, o: { n: number }, k: number, f: () => number, x: number): string { a[1] = x; a[k] = x + 1; return s + " " + o.n + " " + k + " " + f() + " " + a.length; }
function show(a: unknown[]): string { let s = ""; for (let i = 0; i < a.length; i++) s += (Array.isArray(a[i]) ? "[" + show(a[i] as unknown[]) + "]" : Object.is(a[i], -0) ? "-0" : String(a[i])) + ","; return s + a.length; }
function tell(name: string, f: () => unknown): void { let said: string; try { said = String(f()); } catch (e) { said = e instanceof TypeError ? "TypeError" : "threw"; } console.log(name + ": " + said); }
const makers: [string, () => unknown[]][] = [["among values", amongValues], ["minus zero", minusZero], ["whole", whole], ["not a number", notANumber], ["cast", cast], ["two stores", twoStores]];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of makers) tell(name, () => show(make()));
    for (const x of [0.5, -0, 3, NaN, 1e300, 2147483648]) {
        tell("four arrays of values " + x, () => show(four(["a"], ["b"], ["c"], ["d"], x)));
        tell("four arrays of whole numbers " + x, () => show(four([1], [2], [3], [4], x)));
        tell("four arrays of doubles " + x, () => show(fourOfNumbers([1.5], [2.5], [3.5], [4.5], x)));
        tell("four empty arrays " + x, () => show(fourOfNumbers([], [], [], [], x)));
        tell("four kinds " + x, () => show(four(["a"], [1], [1.5], [], x)));
        tell("many " + x, () => many(["a", "b", "c"], "text", { n: 5 }, 2, () => 8, x));
    }
}
