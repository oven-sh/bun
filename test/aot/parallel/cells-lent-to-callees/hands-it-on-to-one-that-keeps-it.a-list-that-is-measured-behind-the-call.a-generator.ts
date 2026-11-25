const log: string[] = [];
const say = (...parts: unknown[]) => { log.push(parts.map(p => (typeof p === "object" && p ? JSON.stringify(p) : String(p))).join(" ")); };
let kept: any = undefined;
const shelf: any[] = [];
const table = new Map<number, any>();
const holder: { it: any } = { it: undefined };
type Named = { a: number; b: number; t: string };
const base = { get peek(): number { kept = this; return 6; } };
function deep(n: number, a: number, b: number, c: number): number { const x = [a, b, c, n]; return n ? deep(n - 1, b + 1, c + 2, a + 3) + x[n & 3] : x[0]; }
function wide(n: number, a0: number, a1: number, a2: number, a3: number, a4: number, a5: number, a6: number, a7: number, a8: number, a9: number, a10: number, a11: number, a12: number, a13: number, a14: number, a15: number, a16: number, a17: number, a18: number, a19: number, a20: number, a21: number, a22: number, a23: number): number { return n ? wide(n - 1, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a0) + a0 : a0 + a23; }
function boxed(n: number, a0: unknown, a1: unknown, a2: unknown, a3: unknown, a4: unknown, a5: unknown, a6: unknown, a7: unknown, a8: unknown, a9: unknown, a10: unknown, a11: unknown, a12: unknown, a13: unknown, a14: unknown, a15: unknown): unknown { return n ? [boxed(n - 1, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a0), a0][1] : a15; }
const nest = (d: number): unknown => (d ? { k: nest(d - 1), v: [d, d] } : null);
const nested = nest(150);
function churn(): void { let junk: unknown[] = []; for (let i = 0; i < 300; i++) junk = [junk.length, { i, t: "t" + i }, [i, i]]; deep(60, 1, 2, 3); wide(40, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5, 21.5, 22.5, 23.5, 24.5); boxed(40, junk, "s1", junk, "s3", junk, "s5", junk, "s7", junk, "s9", junk, "s11", junk, "s13", junk, "s15"); JSON.stringify(nested); Bun.gc(true); deep(40, 7, 8, 9); wide(30, 7.25, 8.25, 9.25, 10.25, 11.25, 12.25, 13.25, 14.25, 15.25, 16.25, 17.25, 18.25, 19.25, 20.25, 21.25, 22.25, 23.25, 24.25, 25.25, 26.25, 27.25, 28.25, 29.25, 30.25); JSON.stringify(nested); }
const show = (o: any): string => (o === undefined ? "nothing" : o === null || (typeof o !== "object" && typeof o !== "function") ? typeof o + " " + String(o) : Array.isArray(o) ? "[" + o.join() + "]" : typeof o === "function" ? "fn:" + show(o()) : "{" + Object.keys(o).map(k => k + ":" + (typeof o[k] === "function" ? "f" : o[k])).join() + "}");
let thrown: any = undefined;
let weight = 0;
let before: any = undefined;
let resultBefore: any = undefined;
function makeIt(x: number): any { return { a: x, b: x * 2 }; }
function inner(p: any): number { for (let w = 0; w < 2; w++) weight += w; kept = p; return 2; }
function callee(o: any): number { for (let w = 0; w < 2; w++) weight += w; return inner(o) + 1; }
function settle(r: any): void { if (r && typeof r.next === 'function') { const all: unknown[] = []; for (const v of r) all.push(v); r = all.join(); } churn(); const now: any = kept; say('result', typeof r === 'object' && r && typeof r.then === 'function' ? 'promise' : show(r), 'read', show(now), 'of the round before', show(before), show(resultBefore)); before = now; resultBefore = typeof r === 'object' && r && typeof r.then !== 'function' ? r : undefined; }
function* lends(x: number): Generator<number, any> { let r: any; for (let w = 0; w < 2; w++) weight += w; const list = [x, x + 1, x + 2]; r = callee(list); const had = list.length; if (Array.isArray(kept)) kept.push(7); say('behind', had, list.length, list[3]); yield 1; return r; }
function run(x: number): void { let r: any; try { const steps = lends(x); let step = steps.next(); while (!step.done) { churn(); step = steps.next(); } r = step.value; } catch (e) { thrown = e; } settle(r); }
for (let round = 0; round < 24; round++) { run(round); churn(); }
console.log(log.join('\n'));
