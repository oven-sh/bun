// A generic function returns `{ ...seed } as T` inside a holder and inside an array, and the caller stores to it.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function wrap<T extends object>(seed: T): { v: T; k: number } { const made = { ...seed } as T; return { v: made, k: 1 } }
interface P { x: number }
row("a generic function yields a holder", () => { const h = wrap<P>({ x: 4 }); h.v.x += 1; return h.v.x + h.k });
function list<T extends object>(seed: T): T[] { const made = { ...seed } as T; return [made] }
row("a generic function yields an array", () => { const l = list<P>({ x: 4 }); l[0].x += 1; return l[0].x });
