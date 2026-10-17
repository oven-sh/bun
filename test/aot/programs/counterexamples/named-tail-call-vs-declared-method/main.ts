// A call by name in tail position stays a tail call though a declaration file that nothing imports declares a method of that name.
declare const console: { log(...a: unknown[]): void };
class Walker { hop(n: number, a: number, b: number, c: number, d: number, e: number): number { return n === 0 ? a + e : (this as any).hop(n - 1, e, a, b, c, d); } }
try { console.log(new Walker().hop(1_000_000, 1, 2, 3, 4, 5)); } catch (e) { console.log((e as Error).constructor.name); }
