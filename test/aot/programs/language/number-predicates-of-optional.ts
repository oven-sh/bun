declare const console: { log(...values: unknown[]): void };
const given: number[] = [0, -0, 1, -1, 2, 0.5, -2.5, 4, 9, 1e21, 2147483648, NaN, Infinity, -Infinity, 5e-324];
function holed(): number[] { const a = given.slice(); delete (a as unknown[])[3]; a.length = a.length + 1; return a; }
function show(v: number): string { return Object.is(v, -0) ? "-0" : String(v); }
function nans(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += (isNaN(a[i]) ? 1 : 0) + "" + (isFinite(a[i]) ? 1 : 0) + (Number.isNaN(a[i]) ? 1 : 0) + (Number.isFinite(a[i]) ? 1 : 0) + (Number.isInteger(a[i]) ? 1 : 0) + (Number.isSafeInteger(a[i]) ? 1 : 0) + ","; return s; }
function powers(a: number[]): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(Math.pow(a[i], 2)) + "," + show(Math.pow(a[i], 0.5)) + "," + show(Math.pow(a[i], 0)) + "," + show(Math.pow(a[i], -1)) + "," + show(Math.pow(a[i], 3.5)) + "," + show(Math.pow(2, i)) + ";"; return s; }
function powersBy(a: number[], y: number): string { let s = ""; for (let i = 0; i < a.length + 1; i++) s += show(Math.pow(a[i], y)) + ","; return s; }
function counted(a: number[]): number { let n = 0; for (let i = 0; i < a.length + 2; i++) { if (isNaN(a[i])) n += 1; if (!isFinite(a[i])) n += 100; } return n; }
function ofMaybe(v: number | undefined): string { return [isNaN(v as number), isFinite(v as number), Number.isNaN(v), Number.isFinite(v), Number.isInteger(v)].map(b => (b ? 1 : 0)).join("") + show(Math.pow(v as number, 2)) + show(Math.pow(v as number, 0)); }
function ofNil(v: number | null): string { return [isNaN(v as number), isFinite(v as number), Number.isNaN(v), Number.isFinite(v), Number.isInteger(v)].map(b => (b ? 1 : 0)).join("") + show(Math.pow(v as number, 2)) + show(Math.pow(v as number, 0)); }
function ofWhole(a: number[], i: number): string { const n: number | undefined = i < a.length ? a.length * 3 : undefined; return (Number.isNaN(n) ? 1 : 0) + "" + (Number.isInteger(n) ? 1 : 0) + (Number.isFinite(n) ? 1 : 0); }
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of [["given", () => given.slice()], ["holed", holed], ["parsed", () => JSON.parse("[0,1,-1,4,9,2147483647]") as number[]], ["none", (): number[] => []], ["holes", () => new Array<number>(2)]] as [string, () => number[]][])
        console.log(name + ": " + nans(make()) + " # " + powers(make()) + " # " + powersBy(make(), 2) + powersBy(make(), 0) + powersBy(make(), NaN) + powersBy(make(), 0.5) + " # " + counted(make()));
    const say = (run: () => string) => { try { return run(); } catch (e) { return e instanceof TypeError ? "TypeError" : "threw"; } };
    console.log([undefined, 0, -0, 3, 2.5, NaN, Infinity].map(v => say(() => ofMaybe(v))).join(" ") + " # " + [null, 0, 3, 2.5, NaN].map(v => say(() => ofNil(v))).join(" ") + " # " + ofWhole(given, 1) + ofWhole(given, 99));
}
