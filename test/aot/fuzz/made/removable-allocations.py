#!/usr/bin/env python3
"""removable-allocations.py <folder>: ONE CASE A FOLDER: a small function that only reads an object made at the call is copied in, and the object is then never made: everything by which a program can tell that the object was made: the order and the effects of its initializers (read or not), what throws among them, absent and inherited members, the identity of what it holds, values caught at the call against variables changed later, awaits, generators, loops, closures, spreads, defaults, patterns."""
import os, sys
out = sys.argv[1]
S = '''declare const console: { log(...v: unknown[]): void }; declare function setTimeout(f: () => void, ms: number): unknown;
const log: string[] = []; const note = <T>(name: string, v: T): T => { log.push(name); return v; };
const rows: [string, () => unknown][] = []; const row = (name: string, f: () => unknown): void => { rows.push([name, f]); };
interface P { a: number; b: number; c?: number; inner?: { v: number }; s?: string }
const readsB = (p: P): number => p.b;
const readsBoth = (p: P): number => p.a * 10 + p.b;
const readsOptional = (p: P): number => (p.c ?? 5) + p.a;
const readsTwice = (p: P): number => p.a + p.a;
const nilTest = (p: P | null): number => p == null ? -1 : p.a;
const chained = (p: P | undefined): number | undefined => p?.inner?.v;
const givesInner = (p: P): { v: number } | undefined => p.inner;
const throughAny = (p: P): string => typeof (p as any).toString + typeof (p as any).constructor + typeof (p as any).nothing + String((p as any).hasOwnProperty);
const castToOther = (p: P): number => (p as { a: number }).a;
const pattern = ({ a, b }: P): number => a - b;
const patternWithDefault = ({ a, c = 7 }: P): number => a + c;
const withDefaultParameter = (p: P = { a: 1, b: 2 }): number => p.a + p.b;
async function afterAwait(p: P): Promise<number> { await null; return p.a + p.b; }
async function afterTwoAwaits(p: P): Promise<string> { const first = p.a; await null; const second = p.b; await new Promise<void>(r => setTimeout(r, 1)); return first + ":" + second + ":" + p.inner?.v; }
function* generated(p: P): Generator<number> { yield p.a; yield p.b; }
const closes = (p: P): (() => number) => () => p.a + p.b;
const throwsIt = (p: P): number => { if (p.a > 0) throw new RangeError("a is " + p.a); return p.b; };
const recursive = (p: P): number => p.a <= 0 ? p.b : recursive({ a: p.a - 1, b: p.b + 1 });
const boom = (): number => { throw new TypeError("an initializer throws"); };
row("the order of initializers, one unread", () => { log.length = 0; const r = readsB({ a: note("a", 1), b: note("b", 2) }); return r + " " + log.join(); });
row("the order, written the other way", () => { log.length = 0; const r = readsB({ b: note("b", 2), a: note("a", 1) }); return r + " " + log.join(); });
row("an unread initializer throws", () => readsB({ a: boom(), b: 2 }));
row("a read one throws behind an unread one", () => { log.length = 0; try { return readsB({ a: note("a", 1), b: boom() }); } catch (e) { return (e as Error).name + " " + log.join(); } });
row("an unread initializer changes what a read one sees", () => { let n = 1; return readsB({ a: (n = 5), b: n }); });
row("both", () => readsBoth({ a: 1, b: 2 })); row("optional absent", () => readsOptional({ a: 1, b: 2 })); row("optional there", () => readsOptional({ a: 1, b: 2, c: 3 })); row("optional undefined", () => readsOptional({ a: 1, b: 2, c: undefined }));
row("twice", () => { let n = 0; return readsTwice({ a: ++n, b: 0 }) + " " + n; });
row("nil tests", () => [nilTest({ a: 1, b: 2 }), nilTest(null)].join()); row("chains", () => [chained({ a: 1, b: 2, inner: { v: 9 } }), chained({ a: 1, b: 2 }), chained(undefined)].join());
row("the identity of what it holds", () => { const inner = { v: 1 }; const got = givesInner({ a: 1, b: 2, inner }); inner.v = 2; return (got === inner) + " " + got!.v; });
row("an inner literal", () => { const x = givesInner({ a: 1, b: 2, inner: { v: 3 } }), y = givesInner({ a: 1, b: 2, inner: { v: 3 } }); return (x === y) + " " + x!.v; });
row("inherited members through any", () => throughAny({ a: 1, b: 2 })); row("a cast", () => castToOther({ a: 4, b: 2 }));
row("a pattern", () => pattern({ a: 5, b: 2 })); row("a pattern with a default", () => [patternWithDefault({ a: 1, b: 0 }), patternWithDefault({ a: 1, b: 0, c: 1 })].join()); row("a default parameter", () => [withDefaultParameter(), withDefaultParameter({ a: 5, b: 5 })].join());
row("a spread", () => { const base: P = { a: 1, b: 2, c: 3 }; return readsBoth({ ...base, b: 9 }) + " " + readsOptional({ ...base }); });
row("a spread with a getter", () => { log.length = 0; const base = { get a(): number { log.push("the getter runs"); return 1; }, b: 2 }; return readsB({ ...base }) + " " + log.join(); });
row("caught at the call", async () => { let n = 1; const p = afterAwait({ a: n, b: n + 1 }); n = 100; return await p; });
row("two awaits", async () => { const inner = { v: 1 }; const p = afterTwoAwaits({ a: 1, b: 2, inner }); inner.v = 50; return await p; });
row("many at once", async () => (await Promise.all(Array.from({ length: 50 }, (_, i) => afterAwait({ a: i, b: i * 2 })))).reduce((x, y) => x + y, 0));
row("a generator", () => { let n = 1; const g = generated({ a: n, b: n + 1 }); n = 100; return [...g].join(); });
row("a closure", () => { let n = 1; const f = closes({ a: n, b: n + 1 }); n = 100; return f() + f(); });
row("it throws", () => throwsIt({ a: 3, b: 1 })); row("the place of the throw", () => { try { throwsIt({ a: 3, b: 1 }); } catch (e) { return String((e as Error).stack).split("\\n").slice(0, 3).map(l => l.trim().replace(/\\(?[^ ()]*[\\\\/]/, "(")).join(" < "); } });
row("recursion", () => recursive({ a: 200, b: 0 }));
row("in a loop", () => { let s = 0; for (let i = 0; i < 5000; i++) s += readsBoth({ a: i & 3, b: i & 7 }) + readsB({ a: 0, b: 1 }); return s; });
row("as a value", () => [{ a: 1, b: 2 }, { a: 3, b: 4 }].map(readsBoth).join()); row("by call and apply", () => [readsBoth.call(null, { a: 1, b: 2 }), readsBoth.apply(null, [{ a: 3, b: 4 }])].join());
const lie: any = "two", nothing: any = undefined, obj: any = { v: "not a number" };
row("a wrong value in an unread member", () => readsB({ a: lie, b: 2 })); row("a wrong value in a read member", () => typeof readsB({ a: 1, b: lie })); row("undefined in a read member", () => String(readsB({ a: 1, b: nothing }))); row("a wrong inner object, unread", () => readsB({ a: 1, b: 2, inner: obj })); row("a wrong inner object, handed out", () => typeof givesInner({ a: 1, b: 2, inner: obj })!.v);
for (let round = 0; round < 3; round++) for (const [name, f] of rows) { let t: string; try { t = String(await f()); } catch (e) { t = "THROWS " + (e as Error).name + ": " + (e as Error).message.slice(0, 60); } if (round !== 1) console.log(round, name + ": " + t); }
'''
os.makedirs(out + "/an-object-that-is-only-read-by-a-small-function", exist_ok=True); open(out + "/an-object-that-is-only-read-by-a-small-function/main.ts", "w").write(S)
print("1 program")
