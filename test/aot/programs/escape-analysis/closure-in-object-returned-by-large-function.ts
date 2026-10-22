// A function too large to inline returns a fresh object with a closure; its callers read the closure, keep the object, or both.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
const kept: any[] = [];
let spins = 0;
function busy(n: number): number { let s = 0; for (let i = 0; i < (n & 3) + 1; i++) { s += i * 3; if (s > 1e9) s = 0; spins++; } for (let j = 0; j < 2; j++) { s ^= j; if (s < -1e9) s = 1; } return s; }

interface H { text: string; count: number; run: () => number }
function holder(n: number): H { busy(n); busy(n + 1); busy(n + 2); return { text: "t" + n, count: n, run: () => 5 }; }

function e1(): void { const h = holder(1); const f = h.run; kept.push(h); say("read-then-keep", f === kept[kept.length - 1].run); }
function e2(): void { const h = holder(2); kept.push(h); const f = h.run; say("keep-then-read", f === kept[kept.length - 1].run); }
function e3(): void { const h = holder(3); say("read-twice", h.run === h.run); }
function e4(flag: boolean): void { const h = holder(4); const f = h.run; if (flag) kept.push(h); say("keep-on-one-path", flag ? f === kept[kept.length - 1].run : f === h.run); }
function e5(): void { const { run, text } = holder(5); const h = holder(5); say("destructured", (run === h.run) + "/" + text + "/" + run()); }
function e6(): void { const h = holder(6); kept.push(h.run); kept.push(h); say("closure-then-object", kept[kept.length - 2] === kept[kept.length - 1].run); }
function e7(): H { const h = holder(7); kept.push(h.run); return h; }
function e8(): void { const h = holder(8); const f = h.run; Bun.gc(true); const g = h.run; kept.push(h); Bun.gc(true); say("collections-between", f === g && g === kept[kept.length - 1].run); }
function e9(): void { let same = 0; for (let i = 0; i < 20; i++) { const h = holder(i); const f = h.run; if (i % 3 === 0) kept.push(h); if (f === (i % 3 === 0 ? kept[kept.length - 1].run : h.run)) same++; } say("in-a-loop", same); }

class Box { x: number; run = () => this.x; constructor(x: number) { busy(x); busy(x + 1); busy(x + 2); this.x = x; } }
function box(n: number): Box { busy(n); busy(n + 1); return new Box(n); }
function g1(): void { const b = box(1); const f = b.run; kept.push(b); say("instance/read-then-keep", f === kept[kept.length - 1].run && f() === 1); }
function g2(): void { const b = box(2); kept.push(b.run); kept.push(b); say("instance/closure-then-object", kept[kept.length - 2] === kept[kept.length - 1].run); }

e1(); e2(); e3(); e4(true); e4(false); e5(); e6();
{ const h = e7(); say("returned-after-read", kept[kept.length - 1] === h.run); }
e8(); e9(); g1(); g2();
console.log(out.join("\n"));
