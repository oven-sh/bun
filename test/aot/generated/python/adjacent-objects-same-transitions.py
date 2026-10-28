#!/usr/bin/env python3
"""adjacent-objects-same-transitions.py <seed>: a store outside an allocation shows as a neighbor's value.
Eight objects of one kind are made one after the other: instances of compiled classes, typed records, dictionaries, closures, arrays of every kind of storage, subclasses of Array, Map and Error, built-in objects.
All eight take the same steps side by side, up to 24 of them, each object with values of its own: properties added by name, under computed keys, by Object.defineProperty, Object.assign and Reflect.set; elements before, between and
after them; deletes; stores to declared fields; runs of 2 to 20 names. Then every object of the group is read back whole. Each scenario runs three times, so the second and third rounds meet inline caches that are warm.
As plain Bun, line by line."""
import random, sys
seed = int(sys.argv[1]); count = 24
r = random.Random(seed)
KINDS = {
 'noFields': 'new NoFields()', 'twoFields': 'new TwoFields(i)', 'sevenFields': 'new SevenFields(i)', 'heirOfTwo': 'new HeirOfTwo(i)', 'withOptional': 'new WithOptional(i)',
 'record': 'makeRecord(i)', 'wideRecord': 'makeWideRecord(i)', 'dictionary': 'makeDictionary(i)', 'emptyLiteral': '({})', 'untypedLiteral': 'makeUntyped(i)', 'parsed': 'JSON.parse(\'{"a":\' + i + \',"b":"b"}\')',
 'arrow': 'makeArrow(i)', 'inner': 'makeInner(i)', 'method': 'makeMethodHolder(i).run', 'bound': 'makeInner(i).bind(null)', 'classItself': 'makeClass(i)', 'asyncArrow': 'makeAsync(i)', 'generatorFunction': 'makeGeneratorFunction(i)',
 'numbers': '[i, i + 1]', 'doubles': '[i + 0.5, i + 1.5]', 'strings': '["s" + i]', 'objects': '[{ t: "e" + i }]', 'emptyArray': '[]', 'holes': 'new Array(3)', 'heirOfArray': 'HeirOfArray.of(i, i + 1)', 'tuple': 'makeTuple(i)',
 'map': 'new Map([[i, i]])', 'set': 'new Set([i])', 'date': 'new Date(i)', 'regexp': 'new RegExp("x" + i)', 'error': 'new Error("e" + i)', 'promise': 'Promise.resolve(i)', 'bytes': 'new Uint8Array(4)', 'floats': 'new Float64Array(2)', 'buffer': 'new ArrayBuffer(8)', 'view': 'new DataView(new ArrayBuffer(8))', 'weakMap': 'new WeakMap()',
 'stringObject': 'new String("s" + i)', 'numberObject': 'new Number(i)', 'generator': 'makeGeneratorFunction(i)()', 'bare': 'Object.create(null)', 'underTyped': 'Object.create(new TwoFields(i))', 'fromEntries': 'Object.fromEntries([["a", i]])', 'heirOfMap': 'new HeirOfMap()', 'heirOfError': 'new HeirOfError("h" + i)',
}
TYPED_FIELDS = {'twoFields': ['a', 'b'], 'sevenFields': ['f0', 'f3', 'f6'], 'heirOfTwo': ['a', 'c'], 'record': ['a', 'b'], 'wideRecord': ['w0', 'w8'], 'withOptional': ['a']}
INDEXES = [0, 1, 2, 3, 7, 8, 15, 16, 31, 64, 100, 1000, 5000, 70000]
def step(kind, k):
    v = f'value(i, {k})'
    w = r.random()
    n = r.randrange(24)
    if w < 0.24: return f'u.n{n} = {v};'
    if w < 0.42: return f'u[name("k", {n})] = {v};'
    if w < 0.60: return f'u[{r.choice(INDEXES[:9] if r.random() < 0.8 else INDEXES)}] = {v};'
    if w < 0.66: return f'u[index({r.choice(INDEXES[:10])})] = {v};'
    if w < 0.72: return f'Object.defineProperty(u, name("d", {n}), {{ value: {v}, writable: true, enumerable: {r.choice(["true", "false"])}, configurable: true }});'
    if w < 0.75: return f'Object.defineProperty(u, {r.choice(INDEXES[:8])}, {{ value: {v}, writable: true, enumerable: true, configurable: true }});'
    if w < 0.80: return f'Object.assign(u, {{ a{n}: {v}, [name("b", {n})]: value(i, {k + 100}), {r.choice(INDEXES[:6])}: value(i, {k + 200}) }});'
    if w < 0.84: return f'Reflect.set(u, name("r", {n}), {v});'
    if w < 0.87: return f'u[symbols[{n % 4}]] = {v};'
    if w < 0.91: return f'delete u.n{n};'
    if w < 0.93: return f'delete u[name("k", {n})];'
    if w < 0.95: return f'delete u[{r.choice(INDEXES[:6])}];'
    if w < 0.97 and kind in TYPED_FIELDS: return f'touch_{kind}(u, i + {k});'
    if w < 0.985: return f'Object.defineProperty(u, name("g", {n}), {{ get() {{ return {v}; }}, enumerable: true, configurable: true }});'
    return f'for (let m = 0; m < {r.randrange(2, 21)}; m++) u[name("m", m)] = value(i, {k} + m);'
print('''export {};
declare const console: any;
class NoFields {}
class TwoFields { a: number; b: string; constructor(i: number) { this.a = i; this.b = "b" + i; } }
class SevenFields { f0: number; f1 = 1; f2 = "two"; f3: number; f4 = true; f5: number[] = []; f6: string; constructor(i: number) { this.f0 = i; this.f3 = i + 0.5; this.f6 = "six" + i; } }
class HeirOfTwo extends TwoFields { c: number; constructor(i: number) { super(i); this.c = i * 2; } }
class WithOptional { a: number; maybe?: string; constructor(i: number) { this.a = i; } }
class HeirOfArray extends Array<number> {}
class HeirOfMap extends Map<number, number> {}
class HeirOfError extends Error {}
interface Rec { a: number; b: string }
interface Wide { w0: number; w1: number; w2: number; w3: number; w4: number; w5: number; w6: number; w7: number; w8: string }
function makeRecord(i: number): Rec { return { a: i, b: "b" + i }; }
function makeWideRecord(i: number): Wide { return { w0: i, w1: 1, w2: 2, w3: 3, w4: 4, w5: 5, w6: 6, w7: 7, w8: "w" + i }; }
function makeDictionary(i: number): Record<string, number> { return { first: i }; }
function makeUntyped(i: any): any { const o: any = {}; o.a = i; o.b = "b" + i; return o; }
function makeArrow(i: number): () => number { return () => i; }
function makeInner(i: number): () => number { return function inner() { return i; }; }
function makeMethodHolder(i: number) { return { run() { return i; } }; }
function makeClass(i: number) { return class Made { static made = i; }; }
function makeAsync(i: number) { return async () => i; }
function makeGeneratorFunction(i: number) { return function* () { yield i; }; }
function makeTuple(i: number): [number, string] { return [i, "t" + i]; }
function makeArguments(..._: number[]): any { return (function (this: any) { return arguments; } as any)(..._); }
function touch_twoFields(o: TwoFields, n: number) { o.a = n; o.b = "B" + n; }
function touch_sevenFields(o: SevenFields, n: number) { o.f0 = n; o.f3 = n + 0.25; o.f6 = "S" + n; }
function touch_heirOfTwo(o: HeirOfTwo, n: number) { o.a = n; o.c = n * 3; }
function touch_record(o: Rec, n: number) { o.a = n; o.b = "B" + n; }
function touch_wideRecord(o: Wide, n: number) { o.w0 = n; o.w8 = "W" + n; }
function touch_withOptional(o: WithOptional, n: number) { o.a = n; o.maybe = "M" + n; }
const symbols = [Symbol("s0"), Symbol("s1"), Symbol("s2"), Symbol("s3")];
let salt = 0;
function name(prefix: string, n: number): string { return prefix + (n + salt); }
function index(n: number): number { return n + salt; }
function value(i: number, k: number): any {
  switch ((i + k) % 7) {
    case 0: return i * 1000 + k;
    case 1: return "v" + i + "_" + k;
    case 2: return { t: i + ":" + k };
    case 3: return i + k / 8 + 0.0625;
    case 4: return (i + k) % 2 === 0;
    case 5: return [i, k];
    default: return k % 3 ? null : undefined;
  }
}
function tag(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(tag).join(" ") + "]";
  if (typeof v === "object" && v !== null) return "t" in v ? "{" + v.t + "}" : "object";
  if (typeof v === "function") return "function";
  if (typeof v === "string") return JSON.stringify(v);
  return Object.is(v, -0) ? "-0" : String(v);
}
function digest(o: any): string {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key)!;
    if (key === "stack" || key === "line" || key === "column" || key === "sourceURL" || key === "originalLine" || key === "originalColumn" || key === "callee") continue;
    let got = "throws";
    if (!("value" in d)) try { got = tag(o[key]); } catch {}
    parts.push(String(key) + (d.enumerable ? "" : "~") + ("value" in d ? (d.writable || key === "prototype" ? "" : "!") + "=" + tag(d.value) : "=get " + got));
  }
  return parts.join(",");
}
function attempt(log: string[], i: number, what: number, run: () => void) {
  try { run(); } catch (error: any) { log[i] = (log[i] ?? "") + " " + what + ":" + error.name; }
}''')
for s in range(count):
    kind = r.choice(list(KINDS))
    steps = [step(kind, k) for k in range(r.randrange(1, 25))]
    print(f'function scenario{s}(round: number) {{')
    print(f'  const group: any[] = []; const log: string[] = [];')
    print(f'  for (let i = 0; i < 8; i++) group.push({KINDS[kind]});')
    for k, text in enumerate(steps):
        print(f'  for (let i = 0; i < 8; i++) {{ const u: any = group[i]; attempt(log, i, {k}, () => {{ {text} }}); }}')
    print(f'  for (let i = 0; i < 8; i++) console.log("{s} {kind} " + round + " " + i + ": " + digest(group[i]) + (log[i] ? " |" + log[i] : ""));')
    print('}')
    print(f'for (let round = 0; round < 3; round++) scenario{s}(round);')
