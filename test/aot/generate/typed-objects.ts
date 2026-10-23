// The programs of typed-objects that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { family, programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `narrowed-identity-array-member.ts	list: { n: number; t: string | null }[]	list: { n: number; t: string }[]	2, list: [{ n: 1, t: "a" }, { n: 2, t: "bc" }]	list.every(x => x.t !== null)	[0]!.list.map(x => x.t.length).join(), kept[0]!.list[1] === all[0]!.list[1]
narrowed-identity-depth-two.ts	inner: { n: number; deeper: { t: string | undefined } }	inner: { n: number; deeper: { t: string } }	2, inner: { n: 2, deeper: { t: "t" } }	inner.deeper.t !== undefined	[0]!.inner.deeper.t.length, kept[0]!.inner.deeper === all[0]!.inner.deeper
narrowed-identity-member-nullable-record.ts	inner: { n: number; t: string | null } | null	inner: { n: number; t: string | null }	1, inner: null }, { id: 2, inner: { n: 2, t: null }	inner !== null	.length, kept[0]!.inner.n, kept[0]!.inner === all[1]!.inner
narrowed-identity-member-record-union.ts	inner: { k: "a"; t: string | null } | { k: "b"; u: number | null }	inner: { k: "a"; t: string } | { k: "b"; u: number }	1, inner: { k: "a", t: "t" } }, { id: 2, inner: { k: "b", u: 2.5 } }, { id: 3, inner: { k: "b", u: null }	inner.k === "a" ? r.inner.t !== null : r.inner.u !== null	.length, kept.map(r => r.inner.k === "a" ? r.inner.t.length : r.inner.u + 1).join(), kept[1]!.inner === all[1]!.inner
narrowed-identity-optional-member.ts	inner?: { n: number; t: string | null }	inner: { n: number; t: string }	1 }, { id: 2, inner: { n: 2, t: "t" }	inner !== undefined && r.inner.t !== null	.length, kept[0]!.inner.t.length, kept[0]!.inner === all[1]!.inner
narrowed-identity-tuple-member.ts	pair: [{ t: string | null; a: number }, { u: number | undefined; b: number }]	pair: [{ t: string; a: number }, { u: number; b: number }]	2, pair: [{ t: "a", a: 1.5 }, { u: 2.5, b: 3.5 }]	pair[0].t !== null && r.pair[1].u !== undefined	[0]!.pair[0].t.length, kept[0]!.pair[1].u + 1, kept[0]!.pair[0] === all[0]!.pair[0], kept[0]!.pair[1] === all[0]!.pair[1]`,
      (a, b, c, d, e) => `// Narrowing a record from one closed record type to another must not copy it.
type Item = { kind: "prompt" | "other"; name: string }
type Built = { item: Item | undefined; path: string }
type WithPath = { item: Item; path: string }
function build(names: string[]): Built[] { return names.map((n): Built => ({ item: n === "" ? undefined : { kind: "prompt", name: n }, path: "/p/" + n })) }
function made(): WithPath { return { item: { kind: "other", name: "made" }, path: "/made" } }
function report(label: string, narrowed: WithPath | undefined, original: Built) {
  if (narrowed === undefined) { console.log(label, "nothing"); return }
  narrowed.path += "!"
  narrowed.item.name += "?"
  console.log(label, narrowed === original, original.path, original.item?.name, narrowed.path, narrowed.item.name, made().path)
}
const built = build(["a", "", "b"])
type B = { id: number; ${a} }
type W = { id: number; ${b} }
const all: B[] = [{ id: ${c} }]
const kept = all.filter((r): r is W => r.${d})
console.log(kept${e})
`,
    ),
    ...family(
      `two-record-types-annotated-variable.ts	assigned to an annotated variable	const o = withName(); const n: Named = o; n.x += 1; return ((n as unknown) === o) + " " + o.x
two-record-types-argument.ts	passed as an argument	const o = withName(); const r = useNamed(o); return r + " " + (o === seen) + " " + o.x
two-record-types-array-element.ts	read from a typed array	const o = withName(); const list: Named[] = hide([o]); const n = list[0]!; n.x += 1; return ((n as unknown) === o) + " " + o.x
two-record-types-array-push.ts	pushed into a typed array	const o = withName(); const list: Named[] = [named]; list.push(o); const n = list[1]!; n.x += 1; return ((n as unknown) === o) + " " + o.x
two-record-types-as-cast.ts	cast with as	const o = withName(); const n = o as Named; n.x += 1; return ((n as unknown) === o) + " " + o.x
two-record-types-callback-parameter.ts	passed to a callback	const o = withName(); let same = false; const each = (f: (p: Named) => void, v: any) => f(v); each(p => { same = (p as unknown) === o; p.x += 1; }, o); return same + " " + o.x
two-record-types-destructured-parameter.ts	passed as a destructured parameter	const o = withName(); const f = ({ name, x }: Named) => name + x; return f(o) + " " + o.x
two-record-types-field-store.ts	stored into a typed field	interface Holder { it: Named } const o = withName(); const h: Holder = { it: named }; h.it = o; h.it.x += 1; return ((h.it as unknown) === o) + " " + o.x
two-record-types-map-key.ts	used as a Map key	const o = withName(); const m = new Map<unknown, number>([[o, 7]]); const n: Named = o; return String(m.get(n))
two-record-types-method-parameter.ts	passed to a method	class K { take(p: Named): boolean { seen = p; p.x += 1; return true; } } const o = withName(); new K().take(o); return (o === seen) + " " + o.x
two-record-types-nested-field.ts	read from a typed field	interface Holder { it: Named } const o = withName(); const h: Holder = hide({ it: o }); h.it.x += 1; return ((h.it as unknown) === o) + " " + o.x
two-record-types-nested-object-identity.ts	nested object keeps its identity	const o = withName(); const n: Named = o; n.s.v += 1; return ((n.s as unknown) === o.s) + " " + o.s.v
two-record-types-nullable-parameter.ts	passed as a nullable parameter	const o = withName(); const f = (p: Named | null): string => { seen = p; if (p) p.x += 1; return p ? p.name : "null"; }; return f(o) + " " + (o === seen) + " " + o.x
two-record-types-passed-twice.ts	passed twice	const o = withName(); useNamed(o); const first = seen; useNamed(o); return (first === seen) + " " + (o === seen) + " " + o.x
two-record-types-return-value.ts	returned from a function	const o = withName(); const give = (): Named => o; const n = give(); n.x += 1; return ((n as unknown) === o) + " " + o.x
two-record-types-type-guard.ts	narrowed by a type guard	const o = withName(); const isNamed = (v: unknown): v is Named => typeof v === "object" && v !== null && "name" in v; const u: unknown = o; if (isNamed(u)) { u.x += 1; return ((u as unknown) === o) + " " + o.x; } return "no"`,
      (
        a,
        b,
      ) => `// An object created as one record type gets an extra property through \`any\` and is then used as a second record type that declares that property. It stays one object: a write through either reference is visible through the other.
function row(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + String(f()));
  } catch (e) {
    console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e)));
  }
}
function hide(v: unknown): any {
  return v;
}
interface Sub { v: number }
interface Point { s: Sub; x: number; y: number }
interface Named { s: Sub; x: number; name: string }
let seen: unknown = null;
function usePoint(p: Point): number {
  seen = p;
  p.x += 1;
  return p.s.v + p.x + p.y;
}
function useNamed(p: Named): string {
  seen = p;
  p.x += 1;
  return p.name + p.x;
}
const point: Point = { s: { v: 1 }, x: 1.5, y: 2.5 };
const named: Named = { s: { v: 1 }, x: 1.5, name: "n" };
function withName(): any {
  const p: Point = { s: { v: 1 }, x: 1.5, y: 2.5 };
  usePoint(p);
  const o: any = hide(p);
  o.name = "n";
  return o;
}
row("typed code only", () => usePoint(point) + " " + useNamed(named));
row("${a}", () => {
  ${b};
});
`,
    ),
    "elements-and-literal-names.ts": text(
      `// Every kind of object gets elements of every kind of storage, then names written in the text, in turns: a function a kind, so that each site meets one kind; four objects a cell, so that what the first has taught serves the others.
type Rec = { a: number; b: string };
class Inst { p = 1; q = "q"; m() { return this.p; } }
class Wide { f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; }
function plainFunction() { return 1; }
const kinds: Array<[string, () => any]> = [
  ["record", () => { const r: Rec = { a: 1, b: "b" }; return r; }],
  ["instance", () => new Inst()],
  ["wide instance", () => new Wide()],
  ["function", () => function () { return 2; }],
  ["arrow", () => () => 3],
  ["bound", () => plainFunction.bind(null)],
  ["class", () => class Local { static s = 1; }],
  ["prototype of a class", () => (class Local2 { m() { return 1; } }).prototype],
  ["prototype of a function", () => (function F() {}).prototype],
  ["untyped literal", () => JSON.parse('{"a":1,"b":"b"}')],
  ["method", () => ({ m() { return 4; } }).m],
  ["async function", () => async function () {}],
  ["generator function", () => function* () {}],
];
const elements: Array<[string, (o: any) => void]> = [
  ["none", () => {}],
  ["int32", o => { o[7] = 7; }],
  ["double", o => { o[0] = 0.5; o[1] = 1.5; }],
  ["values", o => { o[0] = "s"; o[2] = {}; }],
  ["sparse", o => { o[100000] = "far"; o[3] = 3; }],
  ["largest index", o => { o[4294967294] = "last"; o[4294967295] = "a name"; }],
  ["deleted", o => { o[5] = 5; delete o[5]; }],
  ["defined", o => { try { Object.defineProperty(o, "4", { value: "d", writable: true, enumerable: true, configurable: true }); } catch (e) { o[4] = "d"; } }],
];`,
      [
        13,
        n => `function fill${n}(o: any, at: number, store: (o: any) => void): void {
  if (at === 0) store(o);
  o.n0 = 0;
  o.n1 = 3;
  o.n2 = 6;
  o.n3 = 9;
  o.n4 = 12;
  o.n5 = 15;
  if (at === 6) store(o);
  o.n6 = 18;
  o.n7 = 21;
  o.n8 = 24;
  o.n9 = 27;
  o.n10 = 30;
  o.n11 = 33;
  o.n12 = 36;
  o.n13 = 39;
  o.n14 = 42;
  o.n15 = 45;
  o.n16 = 48;
  o.n17 = 51;
  o.n18 = 54;
  o.n19 = 57;
  o.n20 = 60;
  o.n21 = 63;
  o.n22 = 66;
  o.n23 = 69;
  o.n24 = 72;
  o.n25 = 75;
  o.n26 = 78;
  o.n27 = 81;
  o.n28 = 84;
  o.n29 = 87;
  o.n30 = 90;
  o.n31 = 93;
  o.n32 = 96;
  if (at === 33) store(o);
  o.n33 = 99;
  o.n34 = 102;
  o.n35 = 105;
  o.n36 = 108;
  o.n37 = 111;
  o.n38 = 114;
  o.n39 = 117;
}`,
      ],
      `function check(o: any, count: number): string {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += o["n" + i] === i * 3 ? 1 : 0;
  const indices = Object.keys(o).filter(key => /^\\d+$/.test(key)).map(key => key + "=" + String(o[key] && typeof o[key] === "object" ? "o" : o[key])).join();
  return sum + "/" + count + " " + indices;
}
const fills = [fill0, fill1, fill2, fill3, fill4, fill5, fill6, fill7, fill8, fill9, fill10, fill11, fill12];
let lines = 0, digest = 0;
const kept: any[] = [];
for (let k = 0; k < kinds.length; k++) {
  const [kind, make] = kinds[k];
  for (const [how, store] of elements) {
    for (const at of [0, 6, 33]) {
      let said = "";
      for (let turn = 0; turn < 4; turn++) {
        const o = make();
        try { fills[k](o, at, store); said += check(o, 40) + "|"; } catch (e) { said += (e as Error).constructor.name + "|"; }
        kept.push(o);
      }
      const line = kind + " | " + how + " | " + at + ": " + said;
      for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
      lines++;
      if (at === 6) console.log(line);
    }
  }
}
let again = 0;
for (const o of kept) again += check(o, 40).startsWith("40/40") ? 1 : 0;
console.log(lines, digest, again);
`,
    ),
    "record-reaches-other-record-type.json": text(
      `{
  "skipInShell": "it uses what Bun provides and the jsc shell does not: process, structuredClone"
}
`,
    ),
    "record-reaches-other-record-type.ts": text(
      `// An object made as one record type reaches a place of another record type with other optional fields, by every road the type checker allows: assignments, parameters, generics, containers, callbacks.
type Box<T> = { it: T };
function identity<T>(x: T): T { return x; }
interface HasV<T> { get(): T }
class Holder<T> implements HasV<T> { constructor(private x: T) {} get(): T { return this.x; } }
const pick = process.argv.length < 99;
const say = (what: string, got: unknown) => console.log(what + ': ' + String(got));`,
      [
        `0(): V0 { const v: V0 = makeL0(); return v	0(); const before = readM0(v); writeM0(v); say('assignment', before + ' ' + readM0(v) + ' ' + JSON.stringify(v) + ' ' + readM0(makeV0	1(): V1 { const f = (v: V1): V1 => v; return f(makeL1())	1(); const before = readM1(v); writeM1(v); say('a parameter', before + ' ' + readM1(v) + ' ' + JSON.stringify(v) + ' ' + readM1(makeV1
2(): V2 { const f = (): V2 => makeL2(); return f()	2(); const before = readM2(v); writeM2(v); say('a return', before + ' ' + readM2(v) + ' ' + JSON.stringify(v) + ' ' + readM2(makeV2	3(): V3 { const ls: L3[] = [makeL3()]; const vs: V3[] = ls; return vs[0]!	3(); const before = readM3(v); writeM3(v); say('an array, covariantly', before + ' ' + readM3(v) + ' ' + JSON.stringify(v) + ' ' + readM3(makeV3
4(): V4 { const ls: readonly L4[] = [makeL4()]; const vs: readonly V4[] = ls; return vs[0]!	4(); const before = readM4(v); writeM4(v); say('a readonly array', before + ' ' + readM4(v) + ' ' + JSON.stringify(v) + ' ' + readM4(makeV4	5(): V5 { const l = identity(makeL5()); const v: V5 = l; return v	5(); const before = readM5(v); writeM5(v); say('a generic identity', before + ' ' + readM5(v) + ' ' + JSON.stringify(v) + ' ' + readM5(makeV5
6(): V6 { return identity<V6>(makeL6())	6(); const before = readM6(v); writeM6(v); say('a generic, said which', before + ' ' + readM6(v) + ' ' + JSON.stringify(v) + ' ' + readM6(makeV6	7(): V7 { const b: Box<L7> = { it: makeL7() }; const c: Box<V7> = b; return c.it	7(); const before = readM7(v); writeM7(v); say('a box', before + ' ' + readM7(v) + ' ' + JSON.stringify(v) + ' ' + readM7(makeV7
8(): V8 { const m = new Map<string, L8>([['k', makeL8()]]); const r: ReadonlyMap<string, V8> = m; return r.get('k')!	8(); const before = readM8(v); writeM8(v); say('a Map', before + ' ' + readM8(v) + ' ' + JSON.stringify(v) + ' ' + readM8(makeV8	9(): V9 { const s = new Set<L9>([makeL9()]); const r: ReadonlySet<V9> = s; for (const x of r) return x; throw 0	9(); const before = readM9(v); writeM9(v); say('a Set', before + ' ' + readM9(v) + ' ' + JSON.stringify(v) + ' ' + readM9(makeV9
10(): V10 { const takesV = (v: V10): V10 => v; const call = (f: (l: L10) => V10): V10 => f(makeL10()); return call(takesV)	10(); const before = readM10(v); writeM10(v); say("a callback's parameter", before + ' ' + readM10(v) + ' ' + JSON.stringify(v) + ' ' + readM10(makeV10	11(): V11 { const o: { f(l: L11): V11 } = { f(v: V11): V11 { return v; } }; return o.f(makeL11())	11(); const before = readM11(v); writeM11(v); say("a method's parameter", before + ' ' + readM11(v) + ' ' + JSON.stringify(v) + ' ' + readM11(makeV11
12(): V12 { const u: L12 | V12 = pick ? makeL12() : makeV12(); const v: V12 = u; return v	12(); const before = readM12(v); writeM12(v); say('a union', before + ' ' + readM12(v) + ' ' + JSON.stringify(v) + ' ' + readM12(makeV12	13(): V13 { const v: V13 = pick ? makeL13() : makeV13(); return v	13(); const before = readM13(v); writeM13(v); say('a conditional', before + ' ' + readM13(v) + ' ' + JSON.stringify(v) + ' ' + readM13(makeV13
14(): V14 { const none: V14 | undefined = pick ? undefined : makeV14(); const v: V14 = none ?? makeL14(); return v	14(); const before = readM14(v); writeM14(v); say('or', before + ' ' + readM14(v) + ' ' + JSON.stringify(v) + ' ' + readM14(makeV14	15(): V15 { const ls = [makeL15()]; const vs: V15[] = [...ls]; return vs[0]!	15(); const before = readM15(v); writeM15(v); say('a spread array', before + ' ' + readM15(v) + ' ' + JSON.stringify(v) + ' ' + readM15(makeV15
16(): V16 { const vs: V16[] = [1].map(() => makeL16()); return vs[0]!	16(); const before = readM16(v); writeM16(v); say('map', before + ' ' + readM16(v) + ' ' + JSON.stringify(v) + ' ' + readM16(makeV16	17(): V17 { const vs: V17[] = ([] as V17[]).concat([makeL17()]); return vs[0]!	17(); const before = readM17(v); writeM17(v); say('concat', before + ' ' + readM17(v) + ' ' + JSON.stringify(v) + ' ' + readM17(makeV17
18(): V18 { const vs: V18[] = []; vs.push(makeL18()); return vs[0]!	18(); const before = readM18(v); writeM18(v); say('push', before + ' ' + readM18(v) + ' ' + JSON.stringify(v) + ' ' + readM18(makeV18	19(): V19 { const vs: V19[] = Array.from([makeL19()]); return vs[0]!	19(); const before = readM19(v); writeM19(v); say('Array.from', before + ' ' + readM19(v) + ' ' + JSON.stringify(v) + ' ' + readM19(makeV19
20(): V20 { const r: Record<string, L20> = { k: makeL20() }; const vs: V20[] = Object.values(r); return vs[0]!	20(); const before = readM20(v); writeM20(v); say('Object.values', before + ' ' + readM20(v) + ' ' + JSON.stringify(v) + ' ' + readM20(makeV20	21(): V21 { const r: Record<string, L21> = { k: makeL21() }; const q: Record<string, V21> = r; return q['k']!	21(); const before = readM21(v); writeM21(v); say('a record', before + ' ' + readM21(v) + ' ' + JSON.stringify(v) + ' ' + readM21(makeV21
22(): V22 { const t: [L22, number] = [makeL22(), 1]; const u: [V22, number] = t; return u[0]	22(); const before = readM22(v); writeM22(v); say('a tuple', before + ' ' + readM22(v) + ' ' + JSON.stringify(v) + ' ' + readM22(makeV22	23(): V23 { const { it }: Box<V23> = { it: makeL23() }; return it	23(); const before = readM23(v); writeM23(v); say('destructuring', before + ' ' + readM23(v) + ' ' + JSON.stringify(v) + ' ' + readM23(makeV23
24(): V24 { const f = (v: V24 = makeL24()): V24 => v; return f()	24(); const before = readM24(v); writeM24(v); say('a default', before + ' ' + readM24(v) + ' ' + JSON.stringify(v) + ' ' + readM24(makeV24	25(): V25 { class C { v: V25; constructor() { this.v = makeL25(); } } return new C().v	25(); const before = readM25(v); writeM25(v); say('a field of a class', before + ' ' + readM25(v) + ' ' + JSON.stringify(v) + ' ' + readM25(makeV25
26(): V26 { let v: V26 = makeV26(); const set = () => { v = makeL26(); }; set(); return v	26(); const before = readM26(v); writeM26(v); say('a closure variable', before + ' ' + readM26(v) + ' ' + JSON.stringify(v) + ' ' + readM26(makeV26	27(): V27 { function* g(): Generator<V27> { yield makeL27(); } for (const x of g()) return x; throw 0	27(); const before = readM27(v); writeM27(v); say('a generator', before + ' ' + readM27(v) + ' ' + JSON.stringify(v) + ' ' + readM27(makeV27
28(): V28 { const o = { get v(): V28 { return makeL28(); } }; return o.v	28(); const before = readM28(v); writeM28(v); say('a getter', before + ' ' + readM28(v) + ' ' + JSON.stringify(v) + ' ' + readM28(makeV28	29(): V29 { const ls = [makeL29()]; const v: V29 | undefined = ls.find(() => true); return v!	29(); const before = readM29(v); writeM29(v); say('find', before + ' ' + readM29(v) + ' ' + JSON.stringify(v) + ' ' + readM29(makeV29
30(): V30 { return [makeL30()].reduce<V30>((_, x) => x, makeV30())	30(); const before = readM30(v); writeM30(v); say('reduce', before + ' ' + readM30(v) + ' ' + JSON.stringify(v) + ' ' + readM30(makeV30	31(): V31 { const i: HasV<V31> = new Holder<L31>(makeL31()); return i.get()	31(); const before = readM31(v); writeM31(v); say('an interface a class implements', before + ' ' + readM31(v) + ' ' + JSON.stringify(v) + ' ' + readM31(makeV31
32(): V32 { const l = makeL32() satisfies V32; const v: V32 = l; return v	32(); const before = readM32(v); writeM32(v); say('satisfies', before + ' ' + readM32(v) + ' ' + JSON.stringify(v) + ' ' + readM32(makeV32	33(): V33 { const v: V33 = Object.assign(makeL33(), {}); return v	33(); const before = readM33(v); writeM33(v); say("Object.assign's target", before + ' ' + readM33(v) + ' ' + JSON.stringify(v) + ' ' + readM33(makeV33
34(): V34 { const v: V34 = structuredClone(makeL34()); return v	34(); const before = readM34(v); writeM34(v); say('structuredClone', before + ' ' + readM34(v) + ' ' + JSON.stringify(v) + ' ' + readM34(makeV34	35(): V35 { const v: V35 = { ...makeL35() }; return v	35(); const before = readM35(v); writeM35(v); say('a copy by spread', before + ' ' + readM35(v) + ' ' + JSON.stringify(v) + ' ' + readM35(makeV35`,
        (n, a, b, c, d) => `type L${2 * n} = { a: number; n${2 * n}?: string };
type V${2 * n} = { a: number; m${2 * n}?: string };
function makeL${2 * n}(): L${2 * n} { return { a: ${2 * n}, n${2 * n}: 'n' }; }
function makeV${2 * n}(): V${2 * n} { return { a: ${2 * n}, m${2 * n}: 'm' }; }
function route${a}; }
function readM${2 * n}(v: V${2 * n}): string | undefined { return v.m${2 * n}; }
function writeM${2 * n}(v: V${2 * n}): void { v.m${2 * n} = 'w'; }
{ const v = route${b}())); }
type L${2 * n + 1} = { a: number; n${2 * n + 1}?: string };
type V${2 * n + 1} = { a: number; m${2 * n + 1}?: string };
function makeL${2 * n + 1}(): L${2 * n + 1} { return { a: ${2 * n + 1}, n${2 * n + 1}: 'n' }; }
function makeV${2 * n + 1}(): V${2 * n + 1} { return { a: ${2 * n + 1}, m${2 * n + 1}: 'm' }; }
function route${c}; }
function readM${2 * n + 1}(v: V${2 * n + 1}): string | undefined { return v.m${2 * n + 1}; }
function writeM${2 * n + 1}(v: V${2 * n + 1}): void { v.m${2 * n + 1} = 'w'; }
{ const v = route${d}())); }`,
      ],
      `export {};
`,
    ),
    "many-places-add-optional-fields-in-changing-orders.ts": text(
      `// Each of 2,250 functions stores one optional field that its object may not have yet, and the objects get their fields in orders that change from round to round.
// What a place remembers of the last object it saw holds for that place and for objects with the same keys in the same order, and for nothing else:
// the order of the keys of every object is the order in which this program stored them.
const steps = [1, 7, 11, 13, 17, 19, 23, 29];`,
      [
        75,
        n => `type T${n} = { base: number; f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number; };
function make${n}(): T${n} { return { base: ${n} }; }
function add${n}_0(o: T${n}): T${n} { o.f0 = 0; return o; }
function add${n}_1(o: T${n}): T${n} { o.f1 = 1; return o; }
function add${n}_2(o: T${n}): T${n} { o.f2 = 2; return o; }
function add${n}_3(o: T${n}): T${n} { o.f3 = 3; return o; }
function add${n}_4(o: T${n}): T${n} { o.f4 = 4; return o; }
function add${n}_5(o: T${n}): T${n} { o.f5 = 5; return o; }
function add${n}_6(o: T${n}): T${n} { o.f6 = 6; return o; }
function add${n}_7(o: T${n}): T${n} { o.f7 = 7; return o; }
function add${n}_8(o: T${n}): T${n} { o.f8 = 8; return o; }
function add${n}_9(o: T${n}): T${n} { o.f9 = 9; return o; }
function add${n}_10(o: T${n}): T${n} { o.f10 = 10; return o; }
function add${n}_11(o: T${n}): T${n} { o.f11 = 11; return o; }
function add${n}_12(o: T${n}): T${n} { o.f12 = 12; return o; }
function add${n}_13(o: T${n}): T${n} { o.f13 = 13; return o; }
function add${n}_14(o: T${n}): T${n} { o.f14 = 14; return o; }
function add${n}_15(o: T${n}): T${n} { o.f15 = 15; return o; }
function add${n}_16(o: T${n}): T${n} { o.f16 = 16; return o; }
function add${n}_17(o: T${n}): T${n} { o.f17 = 17; return o; }
function add${n}_18(o: T${n}): T${n} { o.f18 = 18; return o; }
function add${n}_19(o: T${n}): T${n} { o.f19 = 19; return o; }
function add${n}_20(o: T${n}): T${n} { o.f20 = 20; return o; }
function add${n}_21(o: T${n}): T${n} { o.f21 = 21; return o; }
function add${n}_22(o: T${n}): T${n} { o.f22 = 22; return o; }
function add${n}_23(o: T${n}): T${n} { o.f23 = 23; return o; }
function add${n}_24(o: T${n}): T${n} { o.f24 = 24; return o; }
function add${n}_25(o: T${n}): T${n} { o.f25 = 25; return o; }
function add${n}_26(o: T${n}): T${n} { o.f26 = 26; return o; }
function add${n}_27(o: T${n}): T${n} { o.f27 = 27; return o; }
function add${n}_28(o: T${n}): T${n} { o.f28 = 28; return o; }
function add${n}_29(o: T${n}): T${n} { o.f29 = 29; return o; }
const adders${n}: ((o: T${n}) => T${n})[] = [add${n}_0, add${n}_1, add${n}_2, add${n}_3, add${n}_4, add${n}_5, add${n}_6, add${n}_7, add${n}_8, add${n}_9, add${n}_10, add${n}_11, add${n}_12, add${n}_13, add${n}_14, add${n}_15, add${n}_16, add${n}_17, add${n}_18, add${n}_19, add${n}_20, add${n}_21, add${n}_22, add${n}_23, add${n}_24, add${n}_25, add${n}_26, add${n}_27, add${n}_28, add${n}_29];
function run${n}(round: number): string { const o = make${n}(); const step = steps[(round + ${n}) % 8]; const count = 1 + ((round * 5 + ${n}) % 30); for (let n = 0, j = round % 30; n < count; n++, j = (j + step) % 30) adders${n}[j](o); return Object.keys(o).join(); }`,
      ],
      `const runs: ((round: number) => string)[] = [run0, run1, run2, run3, run4, run5, run6, run7, run8, run9, run10, run11, run12, run13, run14, run15, run16, run17, run18, run19, run20, run21, run22, run23, run24, run25, run26, run27, run28, run29, run30, run31, run32, run33, run34, run35, run36, run37, run38, run39, run40, run41, run42, run43, run44, run45, run46, run47, run48, run49, run50, run51, run52, run53, run54, run55, run56, run57, run58, run59, run60, run61, run62, run63, run64, run65, run66, run67, run68, run69, run70, run71, run72, run73, run74];
let sum = 0;
function mix(text: string) {
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
}
for (let round = 0; round < 24; round++) {
  for (let g = 0; g < runs.length; g++) {
    const keys = runs[g](round);
    mix(keys);
    if (round === 23 && g % 25 === 0) console.log(keys);
  }
}
console.log(sum);
`,
    ),
  });
