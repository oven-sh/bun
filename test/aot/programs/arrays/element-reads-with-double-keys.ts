declare const console: { log(...values: unknown[]): void };
let deep = 0;
class Rec { constructor(public amount: number) {} }
function at<T>(a: readonly T[], i: number): unknown { if (deep > 0) { deep--; at(a, i); } return a[i]; }
function recAt(a: Rec[], i: number): Rec | undefined { if (deep > 0) { deep--; recAt(a, i); } return a[i]; }
function strAt(a: string[], i: number): string | undefined { if (deep > 0) { deep--; strAt(a, i); } return a[i]; }
function numAt(a: number[], i: number): number | undefined { if (deep > 0) { deep--; numAt(a, i); } return a[i]; }
function from<T>(a: readonly T[], start: number, f: (x: T) => void): void { if (deep > 0) { deep--; from(a, start, f); } for (let i = start; i < a.length; i++) f(a[i]); }
function downFrom<T>(a: readonly T[], start: number, f: (x: T) => void): void { if (deep > 0) { deep--; downFrom(a, start, f); } for (let i = start; i >= 0; i--) f(a[i]); }
function byHalves<T>(a: readonly T[], f: (x: T) => void): void { if (deep > 0) { deep--; byHalves(a, f); } for (let i = 0; i < a.length; i += 0.5) f(a[i]); }
function twoAt<T>(a: readonly T[], b: readonly T[], i: number): string { if (deep > 0) { deep--; twoAt(a, b, i); } return text(a[i]) + text(b[i]) + text(a[i + 1]) + text(b[i - 1]); }
function text(x: unknown): string { return x === undefined ? "U" : x === null ? "N" : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) + "n" : x instanceof Rec ? "R" + x.amount : typeof x === "object" ? "{}" : typeof x + ":" + String(x); }
function tell(name: string, f: () => unknown): void { let t: string; try { t = String(f()); } catch (e) { t = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw " + String(e); } console.log(name + ": " + t); }
const keys = [0, 1, 2, 3, 7, -0, -1, 0.5, 1.5, -0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 1e21, 1e300, 5e-324, 1.0000000000000002];
const kinds: [string, () => unknown[]][] = [
    ["values", () => ["a", null, undefined, 7, 1.5]], ["whole", () => [1, 2, 3]], ["doubles", () => [1.5, -0, 2]], ["empty", () => []], ["holes", () => ["a", , "c"] as unknown[]], ["holes among doubles", () => [1.5, , 3.5] as unknown[]],
    ["named", () => { const a: unknown[] = ["a"]; const r = a as unknown as Record<string, unknown>; r["-1"] = "minus one"; r["1.5"] = "one and a half"; r["NaN"] = "nan"; r["Infinity"] = "inf"; r["4294967295"] = "max"; r["4294967296"] = "over"; r["1e+21"] = "big"; r["5e-324"] = "tiny"; r["9007199254740992"] = "2^53"; return a; }],
    ["sparse", () => { const a: unknown[] = ["a"]; a[4294967294] = "last"; a[2147483648] = "mid"; return a; }], ["frozen", () => Object.freeze(["a", 1.5]) as unknown[]], ["keys", () => Object.keys({ p: 1, q: 2 })],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        tell(name + " at", () => { const a = make(); return keys.map(k => text(at(a, k))).join(" "); });
        tell(name + " two", () => { const a = make(), b = make(); return [0, 1, 0.5, -1, 2, NaN].map(k => twoAt(a, b, k)).join(" "); });
        if (name !== "sparse") for (const s of [0, 1, 0.5, -1, -0, 2, 100, NaN]) tell(name + " from " + s, () => { let t = ""; from(make(), s, x => { t += text(x); }); downFrom(make(), s, x => { t += text(x); }); return t; });
        if (name !== "sparse") tell(name + " by halves", () => { let t = ""; byHalves(make(), x => { t += text(x); }); return t; });
    }
    tell("recs", () => { const a = [new Rec(1), new Rec(2)]; return keys.map(k => text(recAt(a, k))).join(" "); });
    tell("strs", () => { const a = ["p", "q"]; return keys.map(k => text(strAt(a, k))).join(" "); });
    tell("nums", () => { const a = [0.5, 1.5]; return keys.map(k => text(numAt(a, k))).join(" "); });
}
