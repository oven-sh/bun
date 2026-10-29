// Typed functions called from code that does not know their types: every kind of result, `this`, rest parameters, more parameters than registers, exceptions, async functions and generators.
declare const console: any;
const log: any[] = [];
interface P { a: number; next: P | undefined }
class C { v = 3; method(k: number): number { return this.v + k; } get twice(): number { return this.v * 2; } static make(k: number): C { const c = new C(); c.v = k; return c; } }
function object(p: P): P | undefined { return p.next; }
function cell(p: P): P { return p; }
function text(k: number): string { return "t" + k; }
function double(k: number): number { return k / 2; }
function integer(k: number): number { return (k | 0) + 1; }
function truth(k: number): boolean { return k > 1; }
function nothing(k: number): void { log.push("nothing " + k); }
function maybe(k: number): number | undefined { return k > 1 ? k : undefined; }
function anything(k: any): any { return k; }
function never(k: number): never { throw new RangeError("thrown " + k); }
function big(k: bigint): bigint { return k + 1n; }
function sym(k: symbol): symbol { return k; }
function rest(a: number, ...more: number[]): number { return a + more.length; }
function defaults(a: number, b = 5, c?: number): number { return a + b + (c ?? 100); }
function many(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8 + i * 9 + j * 10; }
function manyObjects(a: P, b: P, c: P, d: P, e: P, f: P, g: P): P { return g.a > 0 ? g : a; }
function usesThis(this: P, k: number): P { this.a += k; return this; }
function large(p: P, k: number): P | undefined {
    let q: P | undefined = p; let n = 0;
    for (let i = 0; i < k; i++) { if (!q) break; n += q.a; q = q.next; if (n > 100) n -= 50; if (n < -100) n += 50; if ((n & 3) === 3) n ^= 1; if ((n & 12) === 12) n ^= 4; if ((n & 48) === 48) n ^= 16; }
    if (n === 12345) throw new Error("no"); if (k < 0) return (undefined as any as P).next;
    return q;
}
async function later(k: number): Promise<number> { if (k < 0) throw new RangeError("later " + k); return k + 1; }
function* counts(k: number): Generator<number> { for (let i = 0; i < k; i++) yield i; }
function attempt(name: string, f: () => any) { try { const v = f(); log.push(name + ": " + (typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" || typeof v === "bigint" ? typeof v : String(v))); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
const p: P = { a: 1, next: { a: 2, next: undefined } };
const f: any = { object, cell, text, double, integer, truth, nothing, maybe, anything, never, big, sym, rest, defaults, many, manyObjects, usesThis, large, later, counts };
for (const [name, args] of [["object", [p]], ["object", [p.next]], ["cell", [p]], ["text", [4]], ["double", [5]], ["integer", [6.5]], ["truth", [2]], ["truth", [0]], ["nothing", [7]], ["maybe", [0]], ["maybe", [3]], ["anything", [p]],
    ["anything", []], ["never", [1]], ["big", [5n]], ["sym", [Symbol.iterator]], ["rest", [1]], ["rest", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ["defaults", [1]], ["defaults", [1, 2, 3, 4]], ["many", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["manyObjects", [p, p, p, p, p, p, p.next]], ["large", [p, 1]], ["large", [p, 5]], ["large", [p, -1]]] as [string, any[]][])
    attempt(name + "(" + args.length + ")", () => f[name](...args));
// Null or undefined where an object is declared is accepted, and detected where it is used. (Any other wrong type is rejected on entry, which plain Bun does not do: not part of this test.)
for (const name of ["object", "cell", "manyObjects", "large"]) {
    attempt(name + " of nothing", () => f[name](undefined, 1));
    attempt(name + " of null", () => f[name](null, 1));
}
attempt("usesThis", () => f.usesThis.call({ a: 1, next: undefined }, 2));
attempt("usesThis of undefined", () => f.usesThis.call(undefined, 2));
attempt("usesThis apply", () => Reflect.apply(f.usesThis, { a: 5, next: undefined }, [1]));
const c: any = new C();
attempt("method", () => c.method(1)); attempt("method detached", () => (0, c.method)(1)); attempt("getter", () => c.twice); attempt("static", () => (C as any).make(4).v);
attempt("bound", () => f.many.bind(null, 1, 2, 3)(4, 5, 6, 7, 8, 9, 10)); attempt("new", () => typeof new f.anything(1)); attempt("map", () => [1, 2, 3].map(f.double).join()); attempt("sort", () => [3, 1, 2].sort((f as any).defaults ? (a: number, b: number) => a - b : undefined).join());
attempt("generator", () => [...f.counts(3)].join());
function names(e: any) { return String(e.stack).split("\n").map(line => /\b(never|large|outer)\b/.exec(line)?.[1]).filter(Boolean).join(">"); }
function outer(name: string, ...args: any[]) { const v = f[name](...args); return [v]; }
for (const [name, args] of [["never", [1]], ["large", [p, -1]]] as [string, any[]][]) { try { outer(name, ...args); } catch (e: any) { log.push("stack of " + name + ": " + names(e)); } }
Promise.allSettled([f.later(1), f.later(-1)]).then(all => { for (const r of all) log.push(r.status + " " + (r.status === "fulfilled" ? r.value : (r as any).reason.constructor.name)); console.log(log.join("\n")); });
export {};
