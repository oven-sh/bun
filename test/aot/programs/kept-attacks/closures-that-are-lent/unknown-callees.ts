// Closures that are lent: unknown callees. It prints what plain Bun prints.
interface Walker { each(f: (v: number) => void): void }
class A implements Walker { constructor(public n: number) {} each(f: (v: number) => void) { for (let i = 0; i < this.n; i++) f(i); } }
class B implements Walker { constructor(public n: number) {} each(f: (v: number) => void) { for (let i = this.n; i > 0; i--) f(i); } }
class Keeper implements Walker { kept: ((v: number) => void)[] = []; each(f: (v: number) => void) { this.kept.push(f); f(1); } }
function sum(w: Walker, k: number): number { let s = 0; w.each(v => { s += v * k; }); return s; }
function withLock<T>(f: () => T): T { return f(); }
function locked(k: number): number { return withLock(() => k + 1); }
const table: Record<string, (f: () => number) => number> = { a: f => f(), b: f => f() + 1 };
function byKey(name: string, k: number): number { return table[name](() => k * 2); }
const anyCallee: any = JSON.parse('{"x":1}').x === 1 ? (f: () => number) => f() : null;
function byAny(k: number): number { return anyCallee(() => k * 3); }
const ws: Walker[] = [new A(3), new B(4), new Keeper()];
let total = 0;
for (let i = 0; i < 3000; i++) { total += sum(ws[i % 3], i) + locked(i) + byKey(i & 1 ? "a" : "b", i) + byAny(i); }
console.log(total, (ws[2] as Keeper).kept.length);
