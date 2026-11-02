// Line and column numbers in stack traces, and which `catch` or `finally` handles an exception, when the optimizer moves rarely executed code, joins the equal code of two arms or copies a loop.

declare const console: any;
function frames(e: any): string { return String(e.stack).split("\n").slice(1, 9).map((l: string) => { const m = /^at (?:([^(]*) \()?(native)?.*?(\d+):(\d+)\)?$/.exec(l.trim()); return m ? (m[1] ?? "") + ":" + (m[2] ?? m[3] + ":" + m[4]) : l.trim().slice(0, 40); }).join(" "); }
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
function attempt(name: string, f: () => unknown): void { try { console.log(name + ": " + JSON.stringify(f())); } catch (e: any) { console.log(name + ": " + e.constructor.name + " " + String(e.message).replace(/ is not an object .*/, " is not an object") + " | " + frames(e)); } }
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
function equalArms(k: number): number {
  if (k === 1) return fail(7) + 1;
  if (k === 2) return fail(7) + 1;
  if (k === 3) { return fail(7) + 1; } else if (k === 4) { return fail(7) + 1; }
  return 0;
}
function equalCases(k: number): number {
  let t = 0;
  switch (k) {
    case 1: t = fail(7); break;
    case 2: t = fail(7); break;
    case 3: t = fail(7); break;
    default: t = 1;
  }
  return t + 1;
}
function equalThrows(k: number): number {
  if (k === 1) throw new Error("same");
  if (k === 2) throw new Error("same");
  for (let i = 0; i < 3; i++) { if (i === k - 3) throw new Error("same"); }
  if (k === 6) throw new Error("same");
  return k;
}
function equalReads(o: any, k: number): number {
  if (k === 1) return o.a.b;
  if (k === 2) return o.a.b;
  if (k === 3) return o.a.b; else if (k === 4) return o.a.b;
  return 0;
}
function equalCallsOfMembers(o: any, k: number): number {
  if (k === 1) return o.f() + 1;
  if (k === 2) return o.f() + 1;
  if (k === 3) return o.f() + 1;
  return 0;
}
function equalConstructs(o: any, k: number): unknown {
  if (k === 1) return new o.C();
  if (k === 2) return new o.C();
  return 0;
}
function loops(list: number[], k: number): number {
  let t = 0;
  for (let i = 0; i < list.length; i++) { t += list[i]; if (t === k) fail(t); }
  for (const x of list) { t += x; if (t === k) fail(t); }
  let j = 0; while (j < list.length) { t += list[j++]; if (t === k) fail(t); }
  do { t += 1; if (t === k) fail(t); } while (t < 40);
  return t;
}
function nestedLoops(n: number, k: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { t++; if (t === k) fail(t); else if (t === k + 100) fail(t); }
  return t;
}
function conditional(k: number): number { return (k === 1 ? fail(1) : k === 2 ? fail(1) : k === 3 ? fail(1) : 0) + (k === 4 ? fail(1) : 1); }
function shortCircuit(k: number): unknown { return ((k === 1 && fail(1)) || (k === 2 && fail(1)) || (k === 3 ? fail(1) : null)) ?? fail(1); }
function finallyTwice(k: number): number { let t = 0; try { if (k === 1) fail(1); t = 1; if (k === 2) return t; } finally { if (k >= 2) fail(k); } return t; }
function hot(list: number[], o: any): number { let t = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; if (v < 0) { t += o.missing.deep; } else if (v > 1000) { fail(v); } else if (v === 999) { t += o.f(); } else t += v; } return t; }
for (let k = 0; k < 5; k++) attempt("equal arms " + k, () => equalArms(k) + 0);
for (let k = 0; k < 4; k++) attempt("equal cases " + k, () => equalCases(k) + 0);
for (let k = 0; k < 7; k++) attempt("equal throws " + k, () => equalThrows(k) + 0);
for (let k = 0; k < 5; k++) attempt("equal reads " + k, () => equalReads({}, k) + 0);
for (let k = 0; k < 4; k++) attempt("equal calls of members " + k, () => equalCallsOfMembers({}, k) + 0);
for (let k = 0; k < 3; k++) attempt("equal constructs " + k, () => [equalConstructs({}, k)]);
for (const k of [1, 3, 6, 7, 9, 12, 13, 15, 18, 19, 30, 40, 50]) attempt("loops " + k, () => loops([1, 2, 3], k) + 0);
for (const k of [1, 5, 9, 10, -99, -92]) attempt("nested loops " + k, () => nestedLoops(3, k) + 0);
for (let k = 0; k < 5; k++) attempt("conditional " + k, () => conditional(k) + 0);
for (let k = 0; k < 5; k++) attempt("short circuit " + k, () => [shortCircuit(k)]);
for (let k = 0; k < 4; k++) attempt("finally twice " + k, () => finallyTwice(k) + 0);
const many: number[] = []; for (let i = 0; i < 20000; i++) many.push(i % 900);
attempt("hot", () => hot(many, {}) + 0);
for (const bad of [-1, 1001, 999]) { many[15000] = bad; attempt("hot " + bad, () => hot(many, {}) + 0); }
export {};
