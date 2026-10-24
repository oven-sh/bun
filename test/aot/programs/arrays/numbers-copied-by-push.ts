declare const console: { log(...values: unknown[]): void };
function copyByPush(from: number[]): number[] { const out: number[] = []; for (let i = 0; i < from.length; i++) out.push(from[i]); return out; }
function copyPastTheEnd(from: number[], count: number): number[] { const out: number[] = []; for (let i = 0; i < count; i++) out.push(from[i]); return out; }
function appendTo(out: number[], from: number[]): number { let n = 0; for (let i = 0; i < from.length; i++) n = out.push(from[i]); return n; }
function pushOne(out: number[], from: number[], i: number): number { return out.push(from[i]); }
function everySecond(from: number[]): number[] { const out: number[] = []; for (let i = 0; i < from.length; i += 2) { const x = from[i]; out.push(x); out.push(x); } return out; }
function show(a: unknown[]): string { let s = ""; for (let i = 0; i < a.length; i++) s += (i in a ? Object.is(a[i], -0) ? "-0" : String(a[i]) : "_") + ","; return s + a.length; }
function tell(name: string, f: () => unknown): void { let text: string; try { text = String(f()); } catch (e) { text = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw"; } console.log(name + ": " + text); }
const kinds: [string, () => number[]][] = [
    ["doubles", () => [1.5, 2.5, 3.5]], ["whole", () => [1, 2, 3]], ["empty", () => []], ["values", () => { const a: unknown[] = [1.5, "x", 3]; a[1] = 2; return a as number[]; }],
    ["odd numbers", () => [NaN, -0, 0, Infinity, -Infinity, 1e300, 5e-324, 4294967296, -2147483649]],
    ["a hole", () => { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; }], ["new Array(3)", () => new Array<number>(3)], ["JSON", () => JSON.parse("[1,2.5,3]")],
    ["undefined inside", () => [1.5, undefined, 3.5] as number[]],
    ["frozen", () => Object.freeze([1.5, 2.5]) as number[]], ["sealed", () => Object.seal([1.5, 2.5])], ["sparse", () => { const a = [1.5]; a[150000] = 2; a.length = 3; return a; }],
    ["constants", () => [10, 20, 30, 40]],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        tell(name + " copied", () => show(copyByPush(make())));
        tell(name + " copied past the end", () => show(copyPastTheEnd(make(), 6)));
        tell(name + " every second, twice", () => show(everySecond(make())));
        for (const [other, makeOther] of kinds) tell(name + " appended to " + other, () => { const out = makeOther(); const n = appendTo(out, make()); return n + " " + show(out); });
        for (const i of [0, 1, 2, 3, -1, 1.5, 1000]) tell(name + " one pushed from " + i, () => { const out = [0.5]; const n = pushOne(out, make(), i); return n + " " + show(out); });
    }
    tell("long", () => { const from: number[] = []; for (let i = 0; i < 70000; i++) from.push(i / 2); const out = copyByPush(from); return out[69999] + " " + out.length; });
    tell("onto itself", () => { const a = [1.5, 2.5]; let n = 0; for (let i = 0; i < a.length && n++ < 5; i++) a.push(a[i]); return show(a); });
    tell("a push of its own", () => { const out: number[] = []; (out as unknown as { push(x: number): number }).push = () => 42; return pushOne(out, [1.5], 0) + " " + show(out); });
    tell("a length that cannot grow", () => { const out = [0.5]; Object.defineProperty(out, "length", { writable: false }); return pushOne(out, [1.5], 0); });
}
