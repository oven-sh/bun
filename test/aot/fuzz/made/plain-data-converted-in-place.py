#!/usr/bin/env python3
"""plain-data-converted-in-place.py <folder>: What everybody else can see of plain data that is made over in its own cell. Each row opens with a control: where the data is copied, "same" says false."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
PRE = '''interface S { v: number }
interface T { id: string; n: number; w?: number; sub?: S | null }
const make = (n: number): T => ({ id: "t", n, w: n, sub: { v: n } });
const same = (a: unknown, b: unknown) => a === b;
const say = (what: string, f: () => unknown) => { let said: string; try { said = String(f()); } catch (x) { said = "THROWS " + (x as Error).constructor.name; } console.log(what + ": " + said); };
function use(t: T): string { t.n = t.n + 1; return t.id + ":" + t.n + ":" + (t.w ?? "-") + ":" + (t.sub ? t.sub.v : "-"); }
const parse = (text: string): any => JSON.parse(text.replaceAll("'", String.fromCharCode(34)));
for (let i = 0; i < 100; i++) use(make(i));
say("control", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; r.n = 8; return same(r, raw) + " " + raw.n; });
'''
ROWS = {
 'q1_the_order_of_keys': '''
say("keys", () => { const raw = parse("{'sub':null,'n':7,'w':1,'id':'s'}"); const before = Object.keys(raw).join(); const r: T = raw; use(r); return before + " " + Object.keys(raw).join() + " " + Object.keys(r).join(); });
say("json", () => { const raw = parse("{'n':7,'id':'s'}"); const r: T = raw; use(r); return JSON.stringify(raw) + JSON.stringify(r); });
say("for in", () => { const raw = parse("{'w':1,'n':7,'id':'s'}"); const r: T = raw; use(r); const k: string[] = []; for (const x in raw) k.push(x); return k.join(); });
say("spread", () => { const raw = parse("{'n':7,'id':'s'}"); const r: T = raw; use(r); return JSON.stringify({ ...raw }) + JSON.stringify(Object.assign({}, raw)) + Object.entries(raw).join("|") + Reflect.ownKeys(raw).join(); });
say("added later", () => { const raw = parse("{'n':7,'id':'s'}"); const r: T = raw; r.w = 5; r.sub = null; return Object.keys(raw).join() + JSON.stringify(raw); });
say("added later, the other order", () => { const raw = parse("{'n':7,'id':'s'}"); const r: T = raw; r.sub = null; r.w = 5; return Object.keys(raw).join() + JSON.stringify(raw); });
''',
 'q2_more_than_the_type_says': '''
say("extra", () => { const raw = parse("{'id':'s','extra':'e','n':7,'more':[1,2]}"); const r: T = raw; use(r); return same(r, raw) + " " + Object.keys(raw).join() + " " + raw.extra + raw.more.length + JSON.stringify(raw); });
say("index", () => { const raw = parse("{'id':'s','n':7,'0':'zero','1':'one'}"); const r: T = raw; use(r); return same(r, raw) + " " + Object.keys(raw).join() + raw[0] + raw[1]; });
say("later", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; use(r); raw.later = 5; return raw.later + " " + (r as any).later + " " + Object.keys(r).join(); });
say("many later", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; use(r); for (let i = 0; i < 40; i++) raw["k" + i] = i; return Object.keys(r).length + " " + raw.k39 + " " + use(r); });
say("delete extra", () => { const raw = parse("{'id':'s','extra':'e','n':7}"); const r: T = raw; use(r); delete raw.extra; return ("extra" in raw) + " " + JSON.stringify(r); });
say("many", () => { let text = "{'id':'s','n':7"; for (let i = 0; i < 30; i++) text += ",'k" + i + "':" + i; const raw = parse(text + "}"); const r: T = raw; use(r); return same(r, raw) + " " + Object.keys(raw).length + " " + raw.k29 + " " + raw.n; });
''',
 'q3_optional_and_undefined': '''
say("absent", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; use(r); return ("w" in raw) + " " + ("sub" in raw) + " " + Object.hasOwn(raw, "w") + " " + raw.hasOwnProperty("sub") + " " + raw.w + " " + Object.keys(raw).join(); });
say("undefined", () => { const raw: any = { id: "s", n: 7, w: undefined, sub: undefined }; const r: T = raw; use(r); return ("w" in raw) + " " + ("sub" in raw) + " " + Object.keys(raw).join() + JSON.stringify(raw); });
say("delete", () => { const raw = parse("{'id':'s','n':7,'w':1}"); const r: T = raw; use(r); delete r.w; return ("w" in raw) + " " + Object.keys(raw).join() + " " + use(r); });
say("delete by the other name", () => { const raw = parse("{'id':'s','n':7,'w':1}"); const r: T = raw; use(r); delete raw.w; return ("w" in r) + " " + Object.keys(r).join() + " " + use(r); });
say("delete and add", () => { const raw = parse("{'id':'s','w':1,'n':7}"); const r: T = raw; delete r.w; r.w = 2; return Object.keys(raw).join() + JSON.stringify(raw); });
''',
 'q4_frozen_sealed_and_attributes': '''
const set = (t: T): string => { try { t.n = 80; return "set" + t.n; } catch (e) { return "threw"; } };
const look = (raw: any): string => Object.isFrozen(raw) + " " + Object.isSealed(raw) + " " + Object.isExtensible(raw) + " " + Object.keys(raw).join() + JSON.stringify(Object.getOwnPropertyDescriptor(raw, "n"));
say("frozen", () => { const raw: any = Object.freeze(parse("{'id':'s','n':7}")); const r: T = raw; return same(r, raw) + set(r) + raw.n + look(raw); });
say("sealed", () => { const raw: any = Object.seal(parse("{'id':'s','n':7}")); const r: T = raw; let w = ""; try { r.w = 1; w = "w" + raw.w; } catch (e) { w = "threw"; } return same(r, raw) + set(r) + raw.n + w + look(raw); });
say("closed", () => { const raw: any = Object.preventExtensions(parse("{'id':'s','n':7}")); const r: T = raw; let w = ""; try { r.w = 1; w = "w" + raw.w; } catch (e) { w = "threw"; } return same(r, raw) + set(r) + raw.n + w + look(raw); });
say("read only", () => { const raw: any = Object.defineProperty(parse("{'id':'s'}"), "n", { value: 7, writable: false, enumerable: true, configurable: true }); const r: T = raw; return same(r, raw) + set(r) + raw.n + look(raw); });
say("hidden", () => { const raw: any = Object.defineProperty(parse("{'id':'s'}"), "n", { value: 7, writable: true, enumerable: false, configurable: true }); const r: T = raw; return same(r, raw) + set(r) + raw.n + look(raw); });
say("frozen afterwards", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; use(r); Object.freeze(raw); return set(r) + raw.n + look(raw); });
say("redefined afterwards", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; use(r); let how = "defined"; try { Object.defineProperty(raw, "n", { get() { return 1; }, configurable: true }); } catch (e) { how = "threw"; } return how + raw.n; });
''',
 'q9_a_getter': '''
const set = (t: T): string => { try { t.n = 80; return "set" + t.n; } catch (e) { return "threw"; } };
say("getter", () => { let reads = 0; const raw: any = { id: "s", get n() { reads++; return 7; }, set n(v: number) { reads += 100; } }; const r: T = raw; const s = set(r); return same(r, raw) + s + raw.n + " " + (reads > 100) + Object.keys(raw).join(); });
''',
 'q10_made_over_in_the_middle': '''
const turn = (raw: any): string => { const r: T = raw; return use(r); };
say("for in", () => { const raw = parse("{'w':1,'n':7,'extra':'e','id':'s'}"); const k: string[] = []; for (const x in raw) { k.push(x + "=" + raw[x]); if (k.length === 1) turn(raw); } return k.join(); });
say("for in, then more", () => { const raw = parse("{'n':7,'id':'s'}"); const k: string[] = []; for (const x in raw) { k.push(x); if (k.length === 1) { turn(raw); raw.w = 1; raw.late = 2; } } return k.join() + " " + Object.keys(raw).join(); });
say("replacer", () => { const raw = parse("{'n':7,'id':'s','sub':{'v':1},'extra':[1]}"); let turned = false; return JSON.stringify(raw, function (key, value) { if (!turned && key === "n") { turned = true; turn(raw); } return value; }); });
say("toJSON below", () => { const raw = parse("{'n':7,'id':'s','sub':{'v':1}}"); const holder: any = { a: { toJSON() { turn(raw); return "a"; } }, raw, b: 1 }; return JSON.stringify(holder); });
say("entries", () => { const raw = parse("{'n':7,'id':'s','w':3}"); return Object.entries(raw).map(([k, v], i) => { if (!i) turn(raw); return k + v + raw[k]; }).join(); });
say("rest", () => { const raw = parse("{'n':7,'id':'s','w':3,'extra':1}"); turn(raw); const { id, ...rest } = raw; return id + JSON.stringify(rest); });
say("sort", () => { const list: any[] = [3, 1, 2].map((n) => parse("{'id':'s" + n + "','n':" + n + "}")); const held = list.slice(); list.sort((a, b) => { const x: T = a, y: T = b; return x.n - y.n; }); return list.map((o) => o.id + o.n).join() + held.every((o) => list.includes(o)); });
say("getter of a holder", () => { const raw = parse("{'n':7,'id':'s'}"); const holder: any = { get first() { turn(raw); return 1; }, raw }; return JSON.stringify({ ...holder }) + JSON.stringify(Object.assign({}, holder)); });
say("assign onto it", () => { const raw = parse("{'n':7,'id':'s'}"); turn(raw); Object.assign(raw, { n: 1, w: 2, extra: 3 }); return JSON.stringify(raw) + turn(raw); });
say("assign what does not fit", () => { const raw = parse("{'n':7,'id':'s'}"); turn(raw); let how = "assigned"; try { Object.assign(raw, { n: "no number" }); } catch (e) { how = "threw"; } return how + typeof raw.n; });
say("structuredClone", () => { const raw = parse("{'n':7,'id':'s','extra':1}"); turn(raw); const c = structuredClone(raw); return JSON.stringify(c) + same(c, raw); });
''',
 'q5_who_else_holds_it': '''
const readN = (o: any): number => o.n;
say("caches", () => { const raw = parse("{'id':'s','n':7}"); let sum = 0; for (let i = 0; i < 1000; i++) sum += readN(raw); const r: T = raw; r.n = 8; for (let i = 0; i < 1000; i++) sum += readN(raw); return sum; });
say("holders", () => { const raw = parse("{'id':'s','n':7}"); const map = new Map<any, string>([[raw, "map"]]); const weak = new WeakMap<object, string>([[raw, "weak"]]); const set = new Set<any>([raw]); const list: any[] = [raw]; const holder: any = { raw }; const r: T = raw; r.n = 8; return String(map.get(r)) + String(weak.get(r)) + set.has(r) + list.indexOf(r) + same(holder.raw, r) + holder.raw.n + list[0].n; });
say("written by the other name", () => { const raw = parse("{'id':'s','n':7}"); const r: T = raw; raw.n = 9; return r.n + " " + use(r); });
say("closure", () => { const raw = parse("{'id':'s','n':7}"); const get = () => raw.n; const r: T = raw; r.n = 8; return get(); });
say("below", () => { const raw = parse("{'id':'s','n':7,'sub':{'v':70}}"); const inner = raw.sub; const r: T = raw; r.sub!.v = 71; return inner.v + " " + same(r.sub, inner) + " " + same(raw.sub, inner) + " " + JSON.stringify(raw); });
say("below, swapped", () => { const raw = parse("{'id':'s','n':7,'sub':{'v':70}}"); const r: T = raw; use(r); raw.sub = parse("{'v':1}"); const held = raw.sub; return r.sub!.v + " " + same(r.sub, held); });
say("shared below", () => { const inner = parse("{'v':70}"); const a: any = { id: "a", n: 1, sub: inner }, b: any = { id: "b", n: 2, sub: inner }; const x: T = a, y: T = b; x.sub!.v = 71; return y.sub!.v + " " + inner.v + " " + same(x.sub, y.sub); });
''',
 'q6_two_types_and_cycles': '''
interface B { n: number; id: string; z?: number }
interface N { v: number; next: N | null }
const makeB = (n: number): B => ({ n, id: "b", z: n }); const useB = (b: B): string => b.id + b.n + (b.z ?? "-");
const makeN = (v: number): N => ({ v, next: null }); const len = (t: N): number => { let c = 0; for (let p: N | null = t; p && c < 5; p = p.next) c += 1; return c; };
for (let i = 0; i < 100; i++) { useB(makeB(i)); len(makeN(i)); }
say("two types", () => { const raw = parse("{'id':'s','n':7}"); const a: T = raw; const b: B = raw; a.n = 8; const one = b.n + " " + raw.n; b.n = 9; return one + " " + a.n + " " + raw.n + " " + same(a, raw) + same(b, raw); });
say("two types, a field of the second", () => { const raw = parse("{'id':'s','n':7}"); const a: T = raw; const b: B = raw; b.z = 1; return raw.z + " " + (a as any).z + " " + JSON.stringify(raw); });
say("ring", () => { const ring: any = { v: 1, next: null }; ring.next = { v: 2, next: ring }; const r: N = ring; r.next!.v = 5; return len(r) + " " + same(r.next!.next, r) + same(ring.next.next, ring) + same(r.next, ring.next) + ring.next.v; });
say("itself", () => { const one: any = { v: 1, next: null }; one.next = one; const r: N = one; r.v = 2; return len(r) + " " + same(r.next, r) + one.next.v; });
''',
 'q7_numbers_and_kinds': '''
interface K { i: number; d: number; b: boolean; s: string | null }
const makeK = (n: number): K => ({ i: n, d: n + 0.5, b: n > 1, s: n > 2 ? "s" : null }); const useK = (k: K): string => [k.i + 1, k.d * 2, !k.b, k.s].join();
for (let i = 0; i < 100; i++) useK(makeK(i));
for (const text of ["{'i':1,'d':1.5,'b':false,'s':null}", "{'i':1.25,'d':3,'b':true,'s':'x'}", "{'i':-0,'d':1e300,'b':true,'s':''}", "{'i':2147483648,'d':-2147483649,'b':false,'s':'y'}"])
  say(text, () => { const raw = parse(text); const k: K = raw; const first = useK(k) + same(k, raw) + JSON.stringify(raw) + Object.is(raw.i, k.i) + Object.is(raw.i, -0); k.i = 0.5; k.d = 4; return first + raw.i + raw.d + JSON.stringify(raw); });
say("NaN by the other name", () => { const raw = parse("{'i':1,'d':1.5,'b':false,'s':null}"); const k: K = raw; raw.d = NaN; raw.i = Infinity; return useK(k) + JSON.stringify(raw); });
''',
 'q8_what_is_no_plain_data': '''
const sym = Symbol("s");
const each: Record<string, () => any> = {
  proto_key: () => parse("{'__proto__':{'evil':1},'id':'s','n':7}"),
  symbol: () => ({ id: "s", n: 7, [sym]: "symbol" }),
  no_prototype: () => Object.assign(Object.create(null), { id: "s", n: 7 }),
  inherits: () => Object.assign(Object.create({ inherited: 1, n: 100 }), { id: "s" }),
  array: () => Object.assign([1, 2], { id: "s", n: 7 }),
  function: () => Object.assign(function () {}, { id: "s", n: 7 }),
  instance: () => new (class C { id = "s"; n = 7; m() { return "m"; } })(),
  date: () => Object.assign(new Date(0), { id: "s", n: 7 }),
  proxy: () => new Proxy({ id: "s", n: 7 }, {}),
  three_in_a_literal: () => ({ id: "s", n: 7, x: "x" }),
  two_in_a_literal: () => ({ id: "s", n: 7 }),
  symbol_put_later: () => { const o = parse("{'id':'s','n':7}"); o[sym] = "symbol"; return o; },
  symbol_in_a_roomy_literal: () => ({ id: "s", n: 7, a: 1, b: 2, c: 3, [sym]: "symbol" }),
};
for (const name in each) say(name, () => { const raw = each[name]!(); const r: T = raw; const u = use(r); return u + same(r, raw) + raw.n + Reflect.ownKeys(raw).map(String).join() + same(Object.getPrototypeOf(raw), Object.prototype) + Array.isArray(raw) + typeof raw + raw.evil + raw.inherited + raw[sym] + typeof raw.m; });
''',
}
for name, body in ROWS.items():
    open(name + '.ts', 'w').write(PRE + body.lstrip('\n') + 'export {}\n')
