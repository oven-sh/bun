// A call site that calls function values by their declared signature receives everything that TypeScript lets through.

const g: any = globalThis
function collect(): void { if (typeof g.gc === "function") g.gc(); else if (g.Bun) g.Bun.gc(true) }
class N { constructor(public id: number, public next: N | undefined) { } }
class M extends N { constructor(id: number, public extra: string) { super(id, undefined) } }
const tail = new N(1, undefined), head = new N(2, tail), sub = new M(3, "x")
function attempt(what: () => unknown): string { try { return String(what()) } catch (e) { return (e as Error).constructor.name } }
function show(v: unknown): string { return v instanceof N ? "N" + v.id : typeof v === "function" ? "function" : String(v) }

// The call sites. Each is a separate function, kept from being inlined by its size and by being used as a value.
function num(f: (x: number) => number, x: number): number { return f(x) }
function ref(f: (n: N) => N | undefined, n: N): N | undefined { return f(n) }
function two(f: (a: number, n: N) => number, a: number, n: N): number { return f(a, n) }
function none(f: () => number): number { return f() }
function pred(f: (n: N) => boolean, n: N): boolean { return f(n) }
function str(f: (s: string) => string, s: string): string { return f(s) }
function nothing(f: (n: N) => void, n: N): string { return String(f(n)) }
;(g as any).keep = [num, ref, two, none, pred, str, nothing]
let row = 0
function say(name: string, ...values: unknown[]): void { console.log(++row, name, values.map(show).join(" ")) }

// Functions that match the signature, with and without captures of every representation.
{
    const k = 3, d = 0.5, s = "s", o = head, b = true
    say("no captures", num(x => x + 1, 1), ref(n => n.next, head), two((a, n) => a + n.id, 1, head), none(() => 7), pred(n => n.id > 1, head), str(t => t + "!", "a"), nothing(n => { n.id }, head))
    say("an integer", num(x => x + k, 1), none(() => k))
    say("a double", num(x => x + d, 1), none(() => d))
    say("a string, an object, a boolean", str(t => t + s, "a"), ref(n => n === o ? o.next : o, head), pred(n => b && n === o, head))
    say("several", num(x => x + k + d + s.length + o.id + (b ? 1 : 0), 1), two((a, n) => a + n.id + k + d, 1, tail))
    let count = 0
    const bump = (x: number): number => { count += x; return count }
    say("a variable that is stored to", num(bump, 2), num(bump, 3), count)
}
// Many closures at one site, of one signature.
{ let sum = 0; for (let i = 0; i < 1000; i++) { const j = i; sum += num(i & 1 ? x => x + j : x => x * j, 2) } say("a thousand closures", sum) }
// Function expressions and declarations.
function declared(x: number): number { return x * 10 }
say("declared, an expression", num(declared, 2), num(function (x: number): number { return x - 1 }, 2))

// Another signature, let through by the type system.
say("fewer parameters", num(() => 5, 1), two(a => a, 4, head), two(() => 6, 4, head), ref(() => tail, head))
say("a narrower result", ref(n => n, head), ref(() => sub, head))
say("a wider parameter", ref((n: N | undefined) => n, head), pred((n: unknown) => n === head, head), num((x: number | string) => Number(x) + 1, 1))
say("a narrower parameter, by bivariance of a method", attempt(() => { const h: { m(n: N): string } = { m(n: M): string { return n.extra } }; return h.m(sub) + h.m.call(h, sub) }))
say("optional, default", num((x?: number) => (x ?? 0) + 1, 1), num((x = 9) => x, 1), none((x = 9) => x), none((x?: number) => x === undefined ? 1 : 0))
say("the rest", num((...xs: number[]) => xs.length, 1), two((...xs: unknown[]) => xs.length, 1, head), none((...xs: number[]) => xs.length))
// Through any.
say("through any: another parameter type", attempt(() => num(((s: string) => s.length) as any, 5)), attempt(() => ref(((x: number) => x + 1) as any, head)))
say("through any: another result type", attempt(() => num(((x: number) => "s" + x) as any, 5)), attempt(() => ref(((n: N) => n.id) as any, head)), attempt(() => pred(((n: N) => n.id) as any, head)), attempt(() => str(((s: string) => s.length) as any, "ab")))
say("through any: the result undefined, null", attempt(() => num((() => undefined) as any, 5)), attempt(() => num((() => null) as any, 5)), ref((() => null) as any, head), ref((() => undefined) as any, head))
// No closure of the program, or none that is as it was made.
say("native", num(Math.abs, -2), num(Math.sqrt, 9), str(String, "a"), pred(Boolean as any, head), num(parseFloat as any, 2))
say("bound", num(((a: number, x: number) => a + x).bind(null, 10), 1), ref(((a: N, n: N) => a).bind(null, tail), head), num(declared.bind(null), 3))
say("a proxy", num(new Proxy((x: number) => x + 1, {}), 1), num(new Proxy((x: number) => x + 1, { apply: () => 42 }), 1))
{ const f: any = (x: number) => x + 1; f.a = 1; const h: any = (x: number) => x + 2; Object.freeze(h); const p: any = (x: number) => x + 3; Object.setPrototypeOf(p, null); const i: any = (x: number) => x + 4; i[0] = 1; say("given a property, frozen, no prototype, indexed", num(f, 1), num(h, 1), num(p, 1), num(i, 1)) }
say("a class, no function, nil", attempt(() => num(N as any, 1)), attempt(() => num({} as any, 1)), attempt(() => num(5 as any, 1)), attempt(() => num(undefined as any, 1)), attempt(() => num(null as any, 1)), attempt(() => num("f" as any, 1)))
say("async, a generator", attempt(() => typeof num((async (x: number) => x) as any, 1)), attempt(() => typeof num((function* (x: number) { yield x }) as any, 1)))
say("one that reads this", attempt(() => num(function (this: unknown, x: number): number { return this === undefined ? x : -x }, 4)))
say("a method taken off", num({ m(x: number): number { return x + 1 } }.m, 1), attempt(() => num(new (class { k = 2; m(x: number): number { return x + this.k } })().m, 1)))
// The arguments through any.
say("the argument is not of the type", attempt(() => (num as any)((x: number) => x + 1, "5")), attempt(() => (ref as any)((n: N) => n.next, { id: 1 })), attempt(() => (ref as any)((n: N) => n.next, undefined)), attempt(() => (two as any)((a: number, n: N) => a + n.id, 1)))
say("a subclass for the argument", ref(n => n.next, sub), pred(n => n instanceof M, sub))
// Exceptions through a typed entry.
say("it throws", attempt(() => num(x => { throw new RangeError("r" + x) }, 1)), attempt(() => ref(n => n.next!.next!.next, head)))
{ const k = 5; function guarded(f: (x: number) => number): string { try { return "yielded " + f(1) } catch (e) { return "caught " + (e as Error).message + k } finally { row += 0 } } say("caught at the site", guarded(x => { throw new Error("e" + x) }), guarded(x => x + k)) }
{ const deep = (x: number): number => x <= 0 ? 0 : 1 + num(deep, x - 1); say("recursion through the site", num(deep, 2000)); const forever = (x: number): number => 1 + num(forever, x + 1); say("the stack runs out", attempt(() => num(forever, 0)).slice(0, 10)) }
say("the stack trace names the closure", attempt(() => { const thrower = (x: number): number => { throw new Error("t") }; try { return num(thrower, 1) } catch (e) { return /thrower/.test(String((e as Error).stack)) } }))
// Collections while a typed entry has the captures.
{ const o = new N(50, undefined), s = "cap" + row; const f = (n: N): N | undefined => { collect(); const junk: N[] = []; for (let i = 0; i < 1000; i++) junk.push(new N(i, n)); collect(); return o.id + s.length + junk.length > 0 ? o : n }; say("a collection inside", ref(f, head)) }
{ let sum = 0; for (let i = 0; i < 20000; i++) { const o = new N(i, undefined); sum += two((a, n) => a + n.id + o.id, 1, head); if (i % 5000 === 0) collect() } say("closures made and dropped", sum) }
// A closure that changes between calls at one site.
{ const f: any = (x: number) => x + 1; const before = num(f, 1); f.later = 1; const after = num(f, 1); delete f.later; say("given a property between two calls", before, after, num(f, 1)) }
// NaN, -0, integers outside the int32 range, as raw doubles in both directions.
say("numbers", num(x => x, NaN), Object.is(num(x => x, -0), -0), num(x => x * 2, 2 ** 31), num(x => x / 3, 1), num(x => x | 0, 2 ** 32 + 5), num(x => -x, 0) === 0)

{ const seen: any = function () { return arguments.length * 100 + (arguments[0] === undefined ? 0 : 10) + (arguments[1] === undefined ? 0 : 1) }
  const nothing = (): number => 7, one = (x: number): number => x + 1
  say("every argument reaches an untyped callee", num(seen, 1), two(seen, 1, head), none(seen), num(nothing as any, 1), none(nothing), two(one as any, 4, head))
  const native: any = Math.max; say("and a native one", num(native, 5), two(((a: number, b: unknown) => native(a, 9)) as any, 1, head), num(Math.abs, -3))
  const bound: any = function (this: unknown, a: any, b: any) { return (this === undefined ? 0 : 1000) + arguments.length * 100 + a + (b === undefined ? 0 : 1) }.bind({ }, 2); say("and a bound one", num(bound, 1), none(bound)) }
// `this` at a site that reads the function from an object: the generic path passes the object; a function that matches the signature does not use it.
{ interface Holder { tag: number; f: (x: number) => number }
  function through(h: Holder, x: number): number { return h.f(x) }
  const reads: any = function (this: Holder, x: number) { return this.tag + x }
  say("this reaches what reads it", through({ tag: 100, f: x => x + 1 }, 1), through({ tag: 100, f: reads }, 1), through({ tag: 200, f: reads }, 2), attempt(() => num(reads, 1))) }
console.log("done")
export {}
