declare const console: { log(...values: unknown[]): void };
let deep = 0;
function at<T>(a: readonly T[], i: number): unknown { if (deep > 0) { deep--; at(a, i); } return a[i | 0]; }
function atAny(a: unknown[], i: number): unknown { if (deep > 0) { deep--; atAny(a, i); } const k = i | 0; return a[k]; }
function each<T>(a: readonly T[], f: (x: T, i: number) => void): void { if (deep > 0) { deep--; each(a, f); } for (let i = 0; i < a.length; i++) f(a[i], i); }
function eachOf<T>(a: readonly T[], f: (x: T) => void): void { if (deep > 0) { deep--; eachOf(a, f); } for (const x of a) f(x); }
function beyond<T>(a: readonly T[], f: (x: T, i: number) => void): void { if (deep > 0) { deep--; beyond(a, f); } for (let i = 0; i < a.length + 2; i++) f(a[i], i); }
function down<T>(a: readonly T[], f: (x: T) => void): void { if (deep > 0) { deep--; down(a, f); } for (let i = a.length - 1; i >= 0; i--) f(a[i]); }
function keepsFloats(a: unknown[], x: number, y: number): string { if (deep > 0) { deep--; keepsFloats(a, x, y); } let p = x * 1.5, q = y / 3; let s = ""; for (let i = 0; i < a.length; i++) { s += text(a[i]); p += 0.25; q -= 0.5; } return s + p + "," + q; }
function text(x: unknown): string { return x === undefined ? "U" : x === null ? "N" : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) + "n" : typeof x === "object" ? "{" + Object.keys(x as object).length + "}" : typeof x + ":" + String(x); }
function tell(name: string, f: () => unknown): void { let t: string; try { t = String(f()); } catch (e) { t = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw " + String(e); } console.log(name + ": " + t); }
class Mine extends Array<unknown> { }
const kinds: [string, () => unknown[]][] = [
    ["values", () => ["a", { x: 1 }, null, undefined, true, 7, 1.5, 10n, Symbol.iterator]], ["whole", () => [1, 2, -3, 2147483647, -2147483648]],
    ["doubles", () => [1.5, -0, 0, 2, 1e300, -1e-300, 2147483648, -2147483649, 4294967296, Infinity, -Infinity, 0.1 + 0.2]], ["a NaN among doubles", () => [1.5, NaN, 2.5]],
    ["empty", () => []], ["holes among values", () => ["a", , "c", , ,] as unknown[]], ["holes among whole", () => [1, , 3] as unknown[]], ["holes among doubles", () => [1.5, , 3.5] as unknown[]],
    ["new Array(4)", () => new Array(4)], ["lengthened", () => { const a: unknown[] = ["a"]; a.length = 3; return a; }], ["deleted", () => { const a: unknown[] = [1.5, 2.5, 3.5]; delete a[1]; return a; }],
    ["constants", () => ["x", "y", "z"]], ["keys", () => Object.keys({ a: 1, b: 2 })], ["split", () => "p,q,r".split(",")], ["JSON", () => JSON.parse("[1,2.5,\"s\",null,[1]]")],
    ["frozen", () => Object.freeze(["a", 1.5]) as unknown[]], ["frozen doubles", () => Object.freeze([0.5, 1.5]) as unknown[]], ["sealed", () => Object.seal([1, 2])],
    ["sparse", () => { const a: unknown[] = ["a"]; a[100000] = "z"; a.length = 4; return a; }], ["very sparse", () => { const a: unknown[] = []; a[4000000000] = 1; a.length = 3; return a; }],
    ["a subclass", () => { const a = new Mine(); a.push(1.5, "s"); a.length = 3; return a; }],
    ["an heir", () => { const a: unknown[] = ["a", , "c"] as unknown[]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: "inherited", 4: "beyond" }); return a; }],
    ["own names", () => { const a: unknown[] = [1.5]; (a as unknown as Record<string, unknown>)["-1"] = "minus"; (a as unknown as Record<string, unknown>).x = 1; return a; }],
    ["mapped", () => [1, 2, 3].map(x => x / 2)], ["filtered", () => ["a", 1, null].filter(() => true)], ["sliced", () => [1.5, 2.5, 3.5].slice(1)], ["spread", () => [...[1, 2], ..."ab"]], ["concatenated", () => [1.5].concat([2] as number[])],
    ["popped", () => { const a: unknown[] = [1, 2, 3]; a.pop(); return a; }], ["shifted", () => { const a: unknown[] = [1.5, 2.5, 3.5]; a.shift(); return a; }], ["turned to values", () => { const a: unknown[] = [1.5, 2.5]; a.push("s"); return a; }], ["turned to doubles", () => { const a: unknown[] = [1, 2]; a.push(0.5); return a; }],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        tell(name + " each", () => { let s = ""; each(make(), (x, i) => { s += i + text(x) + " "; }); return s; });
        tell(name + " of", () => { let s = ""; eachOf(make(), x => { s += text(x) + " "; }); return s; });
        tell(name + " beyond", () => { let s = ""; beyond(make(), x => { s += text(x) + " "; }); return s; });
        tell(name + " down", () => { let s = ""; down(make(), x => { s += text(x) + " "; }); return s; });
        tell(name + " at", () => [0, 1, 2, 3, 4, 100, -1, 2147483647, -2147483648].map(i => text(at(make(), i)) + text(atAny(make(), i))).join(" "));
        tell(name + " floats kept", () => keepsFloats(make(), 1.25, 9.75));
    }
    tell("shrinks under the loop", () => { const a: unknown[] = [1.5, 2.5, 3.5, 4.5]; let s = ""; beyond(a, x => { s += text(x); a.length = 2; }); return s; });
    tell("changes kind under the loop", () => { const a: unknown[] = [1, 2, 3, 4]; let s = ""; each(a, (x, i) => { s += text(x); if (i === 0) a[2] = 0.5; if (i === 1) a[3] = "s"; }); return s; });
    tell("long", () => { const a: unknown[] = []; for (let i = 0; i < 70000; i++) a.push(i % 3 ? i / 2 : i); let n = 0, t = 0; each(a, x => { n++; t += x as number; }); return n + " " + t; });
}
