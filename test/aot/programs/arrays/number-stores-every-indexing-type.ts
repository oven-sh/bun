declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public amount: number) {} }
function scale(a: number[], k: number): void { for (let i = 0; i < a.length; i++) a[i] = a[i] * k; }
function copyTo(a: number[], b: number[]): void { for (let i = 0; i < a.length; i++) b[i] = a[i]; }
function squares(n: number): number[] { const out: number[] = []; for (let i = 0; i < n; i++) out[i] = i * i / 2; return out; }
function whole(n: number): number[] { const out: number[] = []; for (let i = 0; i < n; i++) out[i] = i | 0; return out; }
function backwards(n: number): number[] { const out: number[] = []; for (let i = n - 1; i >= 0; i--) out[i] = i + 0.5; return out; }
function everyOther(a: number[], x: number): void { const n = a.length + 4; for (let i = 0; i < n; i += 2) a[i] = x; }
function setAt(a: number[], i: number, x: number): number { a[i] = x; return a.length; }
function shiftLeft(a: number[]): void { for (let i = 1; i < a.length; i++) a[i - 1] = a[i]; }
function recs(a: Rec[], r: Rec): void { for (let i = 0; i < a.length; i++) a[i] = r; }
function show(a: unknown[]): string { let s = ""; for (let i = 0; i < a.length; i++) s += (i in a ? Object.is(a[i], -0) ? "-0" : String(a[i]) : "_") + ","; return s + a.length; }
function tell(name: string, f: () => unknown): void { let text: string; try { text = String(f()); } catch (e) { text = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw"; } console.log(name + ": " + text); }
const kinds: [string, () => number[]][] = [
    ["doubles", () => [1.5, 2.5, 3.5]], ["whole", () => [1, 2, 3]], ["empty", () => []], ["values", () => { const a: unknown[] = [1.5, "x", 3]; a[1] = 2; return a as number[]; }],
    ["a hole", () => { const a = [1.5, 2.5, 3.5]; delete (a as unknown[])[1]; return a; }], ["new Array(3)", () => new Array<number>(3)], ["JSON", () => JSON.parse("[1,2.5,3]")],
    ["frozen", () => Object.freeze([1.5, 2.5]) as number[]], ["sealed", () => Object.seal([1.5, 2.5])], ["sparse", () => { const a = [1.5]; a[150000] = 2; a.length = 3; return a; }],
    ["constants", () => [10, 20, 30, 40]],
];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of kinds) {
        tell(name + " scaled", () => { const a = make(); scale(a, 1.5); return show(a); });
        tell(name + " scaled by NaN", () => { const a = make(); scale(a, NaN); return show(a); });
        tell(name + " scaled by -0", () => { const a = make(); scale(a, -0); return show(a); });
        tell(name + " copied into", () => { const a = make(); copyTo([7.5, 8, NaN, -0, 1e300], a); return show(a); });
        tell(name + " copied from", () => { const b = [0.5]; copyTo(make(), b); return show(b); });
        tell(name + " every other", () => { const a = make(); everyOther(a, 0.25); return show(a); });
        tell(name + " shifted", () => { const a = make(); shiftLeft(a); return show(a); });
        for (const i of [0, 2, 3, 5, 1000, -1, 1.5, 4294967294, 4294967295]) tell(name + " set at " + i, () => { const a = make(); const n = setAt(a, i, 0.75); return n + " " + (a as unknown as Record<string, unknown>)[String(i)]; });
    }
    tell("made", () => show(squares(5)) + " " + show(whole(5)) + " " + show(backwards(5)) + " " + show(squares(0)));
    tell("long", () => { const a = squares(70000); scale(a, 2); return a[69999] + " " + a.length; });
    tell("the same array", () => { const a = [1.5, 2.5, 3.5]; copyTo(a, a); return show(a); });
    tell("grows under the loop", () => { const a = [1.5, 2.5]; let n = 0; for (let i = 0; i < a.length && n++ < 6; i++) a[i + 1] = a[i] + 1; return show(a); });
    tell("recs", () => { const a = [new Rec(1), new Rec(2)]; recs(a, new Rec(3)); return a[0].amount + a[1].amount; });
}
