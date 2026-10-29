#!/usr/bin/env python3
"""literals-alike-by-structure.py <folder>: Literals of plain data of one structure share one layout. Each case has two or three literals that are alike by structure and differ in what they hold, or in what is done to ONE of them, and typed code reads the fields. Three programs a case: A written first, B written first, in two files."""
import os, shutil, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
TS='{ "compilerOptions": { "strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["main.ts"] }\n'
HEAD='declare const console: { log(...values: unknown[]): void };\nfunction t(f: () => unknown): string { try { return String(f()) } catch (e) { return "THROWS " + (e as Error).name } }\n'
# (name, literal A, literal B, the code behind: it names a and b)
N='function n(o: { n: number }): string { return typeof o.n + ":" + (o.n + 1) + ":" + (o.n * 2) + ":" + Object.is(o.n, -0) }\n'
C=[
 ('integer_and_fraction','{ n: 1 }','{ n: 1.5 }',N+'console.log(n(a), n(b));'),
 ('integer_and_large','{ n: 1 }','{ n: 4294967296 }',N+'console.log(n(a), n(b));'),
 ('integer_and_beyond_53','{ n: 7 }','{ n: 9007199254740993 }',N+'console.log(n(a), n(b));'),
 ('integer_and_minus_zero','{ n: 0 }','{ n: -0 }',N+'console.log(n(a), n(b));'),
 ('integer_and_exponent','{ n: 3 }','{ n: 1e21 }',N+'console.log(n(a), n(b));'),
 ('negative','{ n: -1 }','{ n: 1 }',N+'console.log(n(a), n(b));'),
 ('a_fraction_stored_later','{ n: 1 }','{ n: 2 }',N+'a.n = 2.5; console.log(n(a), n(b)); b.n = a.n / 2; console.log(n(a), n(b));'),
 ('strings','{ s: "" }','{ s: "long enough to be a string of its own" }','function s(o: { s: string }): string { return o.s.length + ":" + o.s.toUpperCase() }\nconsole.log(s(a), s(b));'),
 ('booleans','{ f: true }','{ f: false }','function f(o: { f: boolean }): string { return (o.f ? "yes" : "no") + ":" + typeof o.f }\nconsole.log(f(a), f(b));'),
 ('nulls','{ z: null, k: 1 }','{ z: null, k: 2 }','function z(o: { z: null; k: number }): string { return String(o.z) + ":" + o.k }\nconsole.log(z(a), z(b)); (a as any).z = "stored"; console.log(String((a as any).z), z(b));'),
 ('bigints','{ g: 1n }','{ g: 123456789012345678901234567890n }','function g(o: { g: bigint }): string { return typeof o.g + ":" + (o.g * 2n) }\nconsole.log(g(a), g(b));'),
 ('ENUM_LIKE_TABLES','{ A: 0, B: 1, C: 2 }','{ A: 5, B: 7, C: 9 }','function sum(): number { return a.A + a.B * 10 + a.C * 100 + b.A * 1000 + b.B * 10000 + b.C * 100000 }\nconsole.log(sum(), a.A, b.A, a.C, b.C);'),
 ('WORDS_TABLES','{ ok: "OK", cancel: "Cancel" }','{ ok: "Ja", cancel: "Nein" }','function w(): string { return a.ok + a.cancel + b.ok + b.cancel }\nconsole.log(w(), a.ok.length, b.ok.length);'),
 ('FLAGS_TABLES','{ debug: true, fast: false }','{ debug: false, fast: true }','function w(): string { return (a.debug ? "a.debug " : "") + (a.fast ? "a.fast " : "") + (b.debug ? "b.debug " : "") + (b.fast ? "b.fast" : "") }\nconsole.log(w());'),
 ('nested','{ p: { x: 1, y: "a" } }','{ p: { x: 2.5, y: "b" } }','function p(o: { p: { x: number; y: string } }): string { return (o.p.x + 1) + o.p.y }\nconsole.log(p(a), p(b), (a.p as unknown) !== b.p);'),
 ('nested_unlike_inside','{ p: { x: 1 } }','{ p: { y: 1 } }','console.log(a.p.x + 1, b.p.y + 2, Object.keys(a.p).join(), Object.keys(b.p).join());'),
 ('arrays_of_numbers','{ l: [1, 2] }','{ l: [1.5] }','function l(o: { l: number[] }): string { let s = 0; for (const x of o.l) s += x; return o.l.length + ":" + s }\nconsole.log(l(a), l(b)); a.l.push(0.25); console.log(l(a), l(b));'),
 ('arrays_of_strings','{ l: ["a"] }','{ l: ["b", "c"] }','function l(o: { l: string[] }): string { return o.l.join("+") }\nconsole.log(l(a), l(b));'),
 ('arrays_of_alike_literals','{ l: [{ v: 1 }, { v: 2 }] }','{ l: [{ v: 3.5 }] }','function l(o: { l: { v: number }[] }): number { let s = 0; for (const x of o.l) s += x.v; return s }\nconsole.log(l(a), l(b));'),
 ('arrays_of_unlike_literals','{ l: [{ v: 1 }, { w: "x" }] }','{ l: [{ v: 2 }, { w: "y" }] }','console.log(JSON.stringify(a), JSON.stringify(b), a.l[0]!.v, b.l[1]!.w);'),
 ('empty_arrays','{ l: [] }','{ l: [] }','console.log(a.l.length, b.l.length, (a.l as unknown) !== b.l); (a.l as unknown[]).push(1); console.log(a.l.length, b.l.length);'),
 ('empty_array_and_full','{ l: [] as number[] }','{ l: [1] }','console.log(a.l.length, b.l.length);'),
 ('one_frozen','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.freeze(a);\nconsole.log(t(() => { a.n = 5; return a.n }), t(() => { b.n = 6; return b.n }), Object.isFrozen(a), Object.isFrozen(b), a.n + b.n);'),
 ('one_sealed','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.seal(a);\nconsole.log(t(() => { a.n = 5; return a.n }), t(() => { (a as any).more = 1; return "added" }), t(() => { (b as any).more = 1; return Object.keys(b).join() }), Object.isSealed(a), Object.isSealed(b));'),
 ('one_gets_a_property','{ n: 1, s: "a" }','{ n: 2, s: "b" }','(a as any).extra = 9;\nfunction r(o: { n: number; s: string }): string { return o.n + o.s + Object.keys(o).join() }\nconsole.log(r(a), r(b), "extra" in a, "extra" in b);'),
 ('one_loses_a_property','{ n: 1, s: "a" }','{ n: 2, s: "b" }','delete (a as any).n;\nfunction r(o: { n: number; s: string }): string { return typeof o.n + ":" + String(o.n) + o.s + Object.keys(o).join() }\nconsole.log(t(() => r(a)), r(b));'),
 ('one_gets_another_prototype','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.setPrototypeOf(a, { inherited: "yes", toString() { return "mine" } });\nfunction r(o: { n: number; s: string }): string { return o.n + o.s + String(o) + String((o as any).inherited) }\nconsole.log(r(a), r(b));'),
 ('one_gets_a_null_prototype','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.setPrototypeOf(a, null);\nfunction r(o: { n: number; s: string }): string { return o.n + o.s + typeof (o as any).hasOwnProperty }\nconsole.log(r(a), r(b));'),
 ('one_gets_an_accessor','{ n: 1, s: "a" }','{ n: 2, s: "b" }','let calls = 0; Object.defineProperty(a, "n", { get() { calls++; return 40 }, configurable: true, enumerable: true });\nfunction r(o: { n: number; s: string }): string { return (o.n + 1) + o.s }\nconsole.log(r(a), r(b), calls, r(a), calls);'),
 ('one_is_made_read_only','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.defineProperty(a, "n", { writable: false });\nconsole.log(t(() => { a.n = 5; return a.n }), t(() => { b.n = 6; return b.n }));'),
 ('one_is_made_not_enumerable','{ n: 1, s: "a" }','{ n: 2, s: "b" }','Object.defineProperty(a, "n", { enumerable: false });\nconsole.log(Object.keys(a).join(), Object.keys(b).join(), JSON.stringify(a), JSON.stringify(b), a.n + b.n);'),
 ('as_const_beside','{ n: 1, s: "a" } as const','{ n: 1, s: "a" }','function r(o: { readonly n: number; readonly s: string }): string { return o.n + o.s }\nb.n = 3; console.log(r(a), r(b), (a as unknown) !== b);'),
 ('two_as_const','{ n: 1, s: "a" } as const','{ n: 2, s: "b" } as const','const x: 1 = a.n, y: 2 = b.n; console.log(x, y, a.s, b.s);'),
 ('key_order_turned','{ a: 1, b: 2 }','{ b: 2, a: 1 }','function r(o: { a: number; b: number }): string { return Object.keys(o).join() + (o.a * 10 + o.b) }\nconsole.log(r(a), r(b), JSON.stringify(a), JSON.stringify(b));'),
 ('parsed_data_as_its_type','{ n: 1, s: "a" }','{ n: 2, s: "b" }','const d = JSON.parse(\'{"n":3.5,"s":"c","more":1}\') as typeof a;\nfunction r(o: { n: number; s: string }): string { return (o.n + 1) + o.s + Object.keys(o).length }\nconsole.log(r(a), r(b), r(d));'),
 ('reassigned','{ n: 1 }','{ n: 2.5 }','let v = a; const first = v.n; v = b; console.log(first + v.n, v === b);'),
 ('in_a_map','{ n: 1 }','{ n: 1 }','const m = new Map<object, string>([[a, "a"], [b, "b"]]); console.log(m.get(a), m.get(b), m.size, (a as unknown) === b);'),
 ('spread_of_one','{ n: 1, s: "a" }','{ n: 2, s: "b" }','const c = { ...a, n: 9.5 }; console.log(c.n + 1, c.s, a.n, b.n, Object.keys(c).join());'),
 ('made_in_a_function','{ n: 1, s: "a" }','{ n: 2, s: "b" }','function make(i: number) { const o = { n: 3, s: "c" }; o.n += i; return o }\nconst x = make(1), y = make(2.5); console.log(x.n, y.n, a.n, b.n, x !== y);'),
 ('a_default_parameter','{ n: 1, s: "a" }','{ n: 2, s: "b" }','function f(o = { n: 7, s: "d" }): string { return o.n + o.s }\nconsole.log(f(), f(a), f(b));'),
 ('a_class_field','{ n: 1, s: "a" }','{ n: 2, s: "b" }','class K { o = { n: 8, s: "k" } }\nconst k1 = new K(), k2 = new K(); k1.o.n = 0.5; console.log(k1.o.n, k2.o.n, k1.o !== k2.o, a.n + b.n);'),
 ('compared_by_typed_code','{ kind: "a", v: 1 }','{ kind: "b", v: 2 }','function k(o: { kind: string; v: number }): string { return o.kind === "a" ? "is a " + o.v : o.kind === "b" ? "is b " + o.v : "other" }\nconsole.log(k(a), k(b));'),
 ('under_a_union','{ kind: "a", v: 1 }','{ kind: "b", v: 2 }','type U = { kind: "a"; v: number } | { kind: "b"; v: number };\nconst l: U[] = [{ kind: "a", v: 3 }, { kind: "b", v: 4 }];\nfunction k(o: U): string { return o.kind === "a" ? "A" + o.v : "B" + o.v }\nconsole.log(l.map(k).join(), a.kind + a.v, b.kind + b.v);'),
 ('optional_view','{ n: 1, s: "a" }','{ n: 2, s: "b" }','function r(o: { n?: number; s?: string; z?: boolean }): string { return String(o.n) + String(o.s) + String(o.z) }\nconsole.log(r(a), r(b), r({}));'),
 ('one_under_a_given_type','{ timeout: 1, retries: 2 } satisfies Config','{ timeout: 3, retries: 4 }','function r(o: { timeout: number; retries: number }): number { return o.timeout * 10 + o.retries }\nconst parsed = JSON.parse(\'{"timeout":5}\') as Config;\nconsole.log(r(a), r(b), parsed.timeout, parsed.retries);'),
]
EXTRA={'one_under_a_given_type':'interface Config { timeout?: number; retries?: number }\n'}
for d in os.listdir(H):
    if os.path.isdir(os.path.join(H,d)): shutil.rmtree(os.path.join(H,d))
def w(d,name,text):
    os.makedirs(os.path.join(H,d),exist_ok=True); open(os.path.join(H,d,name),'w').write(text)
for name,A,B,code in C:
    x=EXTRA.get(name,'')
    w(name+'__ab','main.ts',HEAD+x+'const a = '+A+';\nconst b = '+B+';\n'+code+'\n')
    w(name+'__ba','main.ts',HEAD+x+'const b = '+B+';\nconst a = '+A+';\n'+code+'\n')
    w(name+'__two','main.ts',HEAD+x+'import { b } from "./other";\nconst a = '+A+';\n'+code+'\n'); w(name+'__two','other.ts',x+'export const b = '+B+';\n')
    for k in ('__ab','__ba','__two'): w(name+k,'tsconfig.json',TS)
print(3*len(C),'folders')
