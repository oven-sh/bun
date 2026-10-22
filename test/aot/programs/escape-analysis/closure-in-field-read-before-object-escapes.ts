// The literal, the read of its closure and the escape of the object are in one function.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
const held: any[] = [];

function c1(): void { const o = { a: 1, m: () => 1 }; const f = o.m; held.push(o); say("read-then-push", f === held[held.length - 1].m); }
function c2(): void { const o = { a: 2, m: () => 2 }; held.push(o); const f = o.m; say("push-then-read", f === held[held.length - 1].m); }
function c3(flag: boolean): void { const o = { a: 3, m: () => 3 }; const f = o.m; if (flag) held.push(o); say("escape-on-one-path", flag ? f === held[held.length - 1].m : f === o.m); }
function c4(flag: boolean): void { const o = { a: 4, m: () => 4 }; let f: unknown; if (flag) f = o.m; held.push(o); say("read-on-one-path", flag ? f === held[held.length - 1].m : held[held.length - 1].m === o.m); }
function c5(): void { const o = { a: 5, m: () => 5 }; const f = o.m, g = o.m; held.push(f); say("closure-escapes", g === held[held.length - 1] && o.m === f); }
function c6(): void { const o = { a: 6, m: () => 6 }; const p = { inner: o }; const f = p.inner.m; held.push(p); say("nested", f === held[held.length - 1].inner.m); }
function c7(n: number): void { let same = 0; for (let i = 0; i < n; i++) { const o = { a: i, m: () => 7 }; const f = o.m; held.push(o); if (f === held[held.length - 1].m) same++; } say("in-a-loop", same); }
function c8(): void { const o = { a: 8, m: () => 8 }; const f = o.m; const copy = { ...o }; held.push(copy); say("spread-after-read", f === held[held.length - 1].m && copy.m === o.m); }
function c9(): unknown { const o = { a: 9, m: () => 9 }; held.push(o.m); return o; }
function c10(): void { const o = { a: 10, m: () => 10 }; const f = o.m; try { held.push(o); throw 1; } catch { say("escape-in-try", f === held[held.length - 1].m); } }
class K11 { x = 11; run: () => number; constructor() { this.run = () => this.x; const f = this.run; held.push(f); } }
function c11(): void { const k = new K11(); say("constructor-reads", held[held.length - 1] === k.run); }
class K12 { x = 12; run = () => this.x; constructor() { held.push(this.run); held.push(this); } }
function c12(): void { const k = new K12(); say("field-then-constructor-reads", held[held.length - 2] === k.run && held[held.length - 1].run === k.run); }

c1(); c2(); c3(true); c3(false); c4(true); c4(false); c5(); c6(); c7(3); c8();
{ const o: any = c9(); say("returned-after-read", held[held.length - 1] === o.m); }
c10(); c11(); c12();
console.log(out.join("\n"));
