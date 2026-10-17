// Small async functions of the kinds that real programs contain.
declare const console: { log(...v: unknown[]): void };
async function g(a: number): Promise<number> { return a * 2; }
async function one(a: number): Promise<number> { const x = await g(a); return x + 1; }
async function two(a: number, b: number): Promise<number> { const x = await g(a); const y = await g(b); return x + y; }
async function none(a: number): Promise<number> { return a + 1; }
async function nothing(): Promise<void> {}
async function guarded(a: number): Promise<number> { try { return await g(a); } catch (e) { return -1; } }
async function looped(n: number): Promise<number> { let s = 0; for (let i = 0; i < n; i++) s += await g(i); return s; }
async function branchy(a: number): Promise<string> { if (a < 0) return "neg"; const x = await g(a); if (x > 10) return "big"; return "small"; }
class Store { items: number[] = []; async add(x: number): Promise<number> { const y = await g(x); this.items.push(y); return this.items.length; } async size(): Promise<number> { return this.items.length; } }
const arrow = async (a: number): Promise<number> => (await g(a)) + 3;
async function passes(a: number): Promise<number> { return g(a); }
async function many(a: number, b: string, c: boolean, d: number[]): Promise<string> { const x = await g(a); const y = await g(d.length); return b + x + c + y; }
(globalThis as any).kept = [g, one, two, none, nothing, guarded, looped, branchy, arrow, passes, many, Store];
const s = new Store();
Promise.all([one(1), two(1, 2), none(1), nothing(), guarded(2), looped(3), branchy(7), s.add(4), s.size(), arrow(5), passes(6), many(1, "b", true, [1, 2])]).then(r => console.log(r.join()));
