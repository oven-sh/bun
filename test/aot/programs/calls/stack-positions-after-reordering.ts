// Line and column numbers in stack traces, and which `catch` or `finally` handles an exception, when the optimizer moves rarely executed code.

declare const console: any;
function frames(e: any): string { return String(e.stack).split("\n").map((l: string) => { const m = /(?:at )?([\w$.<>]*)[ @(]*.*?(\d+):(\d+)\)?$/.exec(l.trim()); return m ? m[1] + ":" + m[2] + ":" + m[3] : l.trim().slice(0, 40); }).slice(0, 9).join(" "); }
function fail(n: number): never { throw new Error("fail " + n); }
function small(n: number): number { return n > 2 ? fail(n) : n + 1; }
function middle(n: number): number { const a = small(n & 1); return a + small(n); }
function outer(n: number): number { let t = 0; for (let i = 0; i < 2; i++) t += middle(i); return t + middle(n); }
function rare(n: number, o: any): number {
    let t = 0;
    for (let i = 0; i < n; i++) {
        if (i === 7) t += o.missing.deep;
        else if (i === 5 && o.five) fail(5);
        else t += small(i & 1);
    }
    return t;
}
function nested(k: number): string {
    const log: string[] = [];
    try {
        try { if (k === 1) fail(1); log.push("a"); small(k === 2 ? 9 : 0); log.push("b"); }
        catch (e: any) { log.push("inner " + e.message); if (k === 2) throw new Error("again"); }
        finally { log.push("finally 1"); if (k === 3) fail(3); }
        log.push("c"); if (k === 4) middle(4);
    } catch (e: any) { log.push("outer " + e.message + " " + frames(e)); }
    finally { log.push("finally 2"); }
    return log.join(", ");
}
function inLoop(): string {
    const log: string[] = [];
    for (let i = 0; i < 6; i++) {
        try { if (i & 1) small(i + 2); else log.push("ok " + small(i & 2 ? 1 : 0)); }
        catch (e: any) { log.push(e.message); if (i === 3) continue; }
        finally { if (i === 4) break; }
    }
    return log.join(", ");
}
class Shape { constructor(public w: number) { if (w < 0) fail(w); } area(): number { return this.w > 100 ? fail(this.w) : this.w * this.w; } get bad(): number { return fail(-1); } static make(w: number): Shape { return new Shape(w); } }
function throughMembers(k: number): number { const s = Shape.make(k === 1 ? -5 : 200); return k === 2 ? s.area() : k === 3 ? s.bad : 0; }
function throughCallbacks(k: number): number { return [1, 2, 3].map(x => x === k ? fail(x) : x).reduce((a, b) => a + b, 0); }
function nil(o: any, k: number): unknown { return k === 1 ? o.a.b : k === 2 ? o.f() : k === 3 ? o[0][1] : k === 4 ? new o.C() : (o as string[]).length.toFixed(200); }
async function later(k: number): Promise<number> { await 0; if (k === 1) fail(1); const v = await Promise.resolve(2); return k === 2 ? small(v + 5) : v; }
async function asyncOuter(k: number): Promise<number> { try { return await later(k); } finally { await 0; } }
function* generated(k: number): Generator<number> { yield 1; if (k === 1) fail(1); try { yield small(k === 2 ? 8 : 0); } finally { yield 9; } }
function attempt(name: string, f: () => unknown): void { try { console.log(name + ": " + JSON.stringify(f())); } catch (e: any) { console.log(name + ": " + e.constructor.name + " " + String(e.message).slice(0, 60) + " | " + frames(e)); } }
attempt("outer 1", () => outer(1)); attempt("outer 3", () => outer(3)); attempt("outer 7", () => outer(7));
attempt("rare 4", () => rare(4, {})); attempt("rare five", () => rare(9, { five: true })); attempt("rare seven", () => rare(9, {}));
for (let k = 0; k < 5; k++) attempt("nested " + k, () => nested(k));
attempt("in a loop", inLoop);
for (let k = 0; k < 4; k++) attempt("members " + k, () => throughMembers(k));
for (let k = 0; k < 4; k++) attempt("callbacks " + k, () => throughCallbacks(k));
for (let k = 1; k < 6; k++) attempt("nil " + k, () => nil({}, k));
for (let k = 0; k < 3; k++) { try { console.log("async " + k + ": " + await asyncOuter(k)); } catch (e: any) { console.log("async " + k + ": " + e.message + " | " + frames(e)); } }
for (let k = 0; k < 3; k++) attempt("generator " + k, () => [...generated(k)]);
function deep(n: number): number { return n ? deep(n - 1) + 1 : fail(0); }
attempt("deep", () => deep(5));
function overflow(n: number): number { return overflow(n + 1) + 1; }
try { overflow(0); } catch (e: any) { console.log("overflow: " + e.constructor.name); }
export {};
