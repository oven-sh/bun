// Objects in drawn states are copied in drawn ways: spreads, Object.assign onto new and used targets, rest patterns, constructors that take their fields from an argument, descriptors, entries, clones.
// Each way is a function of its own, and the schedule repeats pairs of a way and a state, so that a copy meets what an earlier copy of the same or of another state left behind.
//
// A program is a seed. The same seed always writes the same program.
import { look, Random } from "./every-way-to-look-at-an-object";

const types = `
const sym = Symbol("sym");
class A { a = 1; b = "s"; declare c?: number; declare d?: string; e: number | null = null; }
class B { b = "tb"; a = 2.5; declare e?: number | null; declare z?: boolean; }
class W { w0 = 0; a = 3; w1 = "w"; b = "wb"; w2 = true; c?: number; w3 = 1.5; d?: string; e: number | null = 4; }
class H extends A { h = "heir"; declare i?: number; }
class Init { a = 0; b = ""; declare c?: number; declare d?: string; e: number | null = null; constructor(init: Partial<A>) { Object.assign(this, init); } }
interface I { a: number; b: string; c?: number; d?: string }
interface N { a: 0 | 1 | 2; b: "s" | "t"; e?: null }
`;

// Each returns any so that a schedule may hand any of them to any form of copy.
const makers: [string, string][] = [
  ["fresh A", `new A()`],
  ["A with c", `(() => { const o = new A(); o.c = 7; return o; })()`],
  ["A with d then c", `(() => { const o = new A(); o.d = "d"; o.c = 7; return o; })()`],
  ["A with c then d", `(() => { const o = new A(); o.c = 8; o.d = "dd"; return o; })()`],
  ["A with added keys", `(() => { const o: any = new A(); o.x1 = 1; o.x2 = "two"; return o; })()`],
  ["A with added keys the other way", `(() => { const o: any = new A(); o.x2 = "two"; o.x1 = 1; return o; })()`],
  ["A with a text in a", `(() => { const o: any = new A(); o.a = "text"; return o; })()`],
  ["A with a getter for b", `(() => { const o = new A(); Object.defineProperty(o, "b", { get() { return "got"; }, enumerable: true, configurable: true }); return o; })()`],
  ["A with b hidden", `(() => { const o = new A(); Object.defineProperty(o, "b", { enumerable: false }); return o; })()`],
  ["A with a symbol and indices", `(() => { const o: any = new A(); o[sym] = "symbol"; o[2] = "two"; o[0] = "zero"; return o; })()`],
  ["frozen A", `Object.freeze(new A())`],
  ["sealed A with c", `(() => { const o = new A(); o.c = 1; return Object.seal(o); })()`],
  ["A whose a came again", `(() => { const o: any = new A(); delete o.a; o.a = 9; return o; })()`],
  ["A without b", `(() => { const o: any = new A(); delete o.b; return o; })()`],
  ["A with a fraction", `(() => { const o = new A(); o.a = 1.5; o.e = -0; return o; })()`],
  ["A with large numbers", `(() => { const o = new A(); o.a = 2 ** 31; o.e = -(2 ** 31); o.c = 2 ** 53; return o; })()`],
  ["A with NaN", `(() => { const o = new A(); o.a = NaN; o.e = Infinity; o.c = NaN; return o; })()`],
  ["A with undefined where null is declared", `(() => { const o: any = new A(); o.e = undefined; return o; })()`],
  ["A with c undefined", `(() => { const o = new A(); o.c = undefined; return o; })()`],
  ["A with a getter that throws", `(() => { const o = new A(); Object.defineProperty(o, "b", { get() { throw new RangeError("b"); }, enumerable: true, configurable: true }); return o; })()`],
  ["A with a getter that changes it", `(() => { const o: any = new A(); o.c = 1; Object.defineProperty(o, "b", { get() { delete this.c; this.late = 1; return "changed"; }, enumerable: true, configurable: true }); return o; })()`],
  ["fresh B", `new B()`],
  ["B with e and z", `(() => { const o = new B(); o.z = true; o.e = 5; return o; })()`],
  ["fresh W", `new W()`],
  ["fresh H", `new H()`],
  ["H with i and c", `(() => { const o = new H(); o.i = 1; o.c = 2; return o; })()`],
  ["literal a b", `((): I => ({ a: 1, b: "lit" }))()`],
  ["literal b a c", `((): I => ({ b: "lit", a: 2, c: 3 }))()`],
  ["literal a b c d", `((): I => ({ a: 1, b: "lit", c: 3, d: "d" }))()`],
  ["narrow literal", `((): N => ({ a: 2, b: "t" }))()`],
  ["parsed", `JSON.parse('{"a":5,"b":"parsed","c":6}')`],
  ["parsed in another order", `JSON.parse('{"d":"pd","b":"parsed","zz":1,"a":5.5}')`],
  ["parsed with other types", `JSON.parse('{"a":"5","b":6,"c":null,"e":"e"}')`],
  ["parsed by type", `(JSON.parse('{"a":5,"b":"typed","c":6}') as I)`],
  ["dictionary", `(() => { const o = Object.create(null); o.b = "dict"; o.q = 1; o.a = 4; return o; })()`],
  ["empty", `({})`],
  ["made by Init", `new Init({ a: 5, c: 6 })`],
  ["made by Init from an A", `new Init((() => { const o = new A(); o.d = "x"; return o; })())`],
  ["array", `[10, 20]`],
  ["text", `"xy"`],
  ["null", `null`],
  ["proxy of an A", `new Proxy(new A(), {})`],
  ["heir of an A", `Object.create(new A())`],
  ["map", `new Map([["a", 1]])`],
  ["function with properties", `Object.assign(function f() {}, { a: 1, b: "fn" })`],
];

export function program(seed: number): string {
  const r = new Random(seed);
  const chosen = r.sample(makers, 5 + r.int(5));
  const make = (i: number) => `make${i}()`;
  const anyMaker = () => make(r.int(chosen.length));
  const forms: ((n: number) => string)[] = [
    n => `function copy${n}(s: any): unknown { return { ...s }; }`,
    n => `function copy${n}(s: any): unknown { return { ...s, a: "last" }; }`,
    n => `function copy${n}(s: any): unknown { return { a: "first", ...s }; }`,
    n => `function copy${n}(s: any): unknown { return { zz: 0, ...s, b: 1, yy: 2 }; }`,
    n => `function copy${n}(s: any): unknown { return { ...s, ...${anyMaker()} }; }`,
    n => `function copy${n}(s: any): unknown { return { ...${anyMaker()}, ...s }; }`,
    n => `function copy${n}(s: any): unknown { return { ...s, ...s }; }`,
    n => `function copy${n}(s: any): I { return { ...s }; }`,
    n => `function copy${n}(s: any): I { return { a: 0, b: "", ...s }; }`,
    n => `function copy${n}(s: A): A { return { ...s }; }`,
    n => `function copy${n}(s: A): I { return { ...s, c: 1 }; }`,
    n => `function copy${n}(s: I): I { return { ...s, d: "dd" }; }`,
    n => `function copy${n}(s: any): unknown { return Object.assign({}, s); }`,
    n => `function copy${n}(s: any): unknown { return Object.assign(new A(), s); }`,
    n => `function copy${n}(s: any): unknown { return Object.assign(new B(), s); }`,
    n => `function copy${n}(s: any): unknown { return Object.assign(new W(), s); }`,
    n => `function copy${n}(s: any): unknown { return Object.assign(new H(), s); }`,
    n => `function copy${n}(s: any): unknown { const t = ${anyMaker()} ?? {}; try { Object.assign(t, s); } catch (e) { console.log("assign throws " + (e as Error).constructor.name); } return t; }`,
    n => `function copy${n}(s: any): unknown { return Object.assign({}, s, ${anyMaker()}); }`,
    n => `function copy${n}(s: any): unknown { return Object.assign(new A(), ${anyMaker()}, s); }`,
    n => `function copy${n}(s: any): unknown { return new Init(s ?? {}); }`,
    n => `function copy${n}(s: any): unknown { const { a, ...rest } = s; return rest; }`,
    n => `function copy${n}(s: any): unknown { const { b, c, ...rest } = s; return [b, c, rest]; }`,
    n => `function copy${n}(s: any): unknown { const { [hide("a")]: _, ...rest } = s; return rest; }`,
    n => `function copy${n}(s: A): unknown { const { e, ...rest } = s; return rest; }`,
    n => `function copy${n}(s: any): unknown { const { x1, zz, ...rest } = s; return rest; }`,
    n => `function copy${n}(s: any): unknown { const t = Object.preventExtensions(new A()); try { Object.assign(t, s); } catch (e) { console.log("assign throws " + (e as Error).constructor.name); } return t; }`,
    n => `function copy${n}(s: any): unknown { const t = new A(); Object.defineProperty(t, "b", { writable: false }); try { Object.assign(t, s); } catch (e) { console.log("assign throws " + (e as Error).constructor.name); } return t; }`,
    n => `function copy${n}(s: any): unknown { const t = new A(); Object.defineProperty(t, "b", { set(v) { console.log("setter b " + show(v) + " a=" + show(this.a) + " e=" + show(this.e)); }, configurable: true, enumerable: true }); Object.assign(t, s); return t; }`,
    n => `function copy${n}(s: any): unknown { return Object.fromEntries(Object.entries(s ?? {})); }`,
    n => `function copy${n}(s: any): unknown { return Object.defineProperties({}, Object.getOwnPropertyDescriptors(s ?? {})); }`,
    n => `function copy${n}(s: any): unknown { return Object.defineProperties(new A(), Object.getOwnPropertyDescriptors(s ?? {})); }`,
    n => `function copy${n}(s: any): unknown { return Object.create(A.prototype, Object.getOwnPropertyDescriptors(s ?? {})); }`,
    n => `function copy${n}(s: any): unknown { return structuredClone(s); }`,
    n => `function copy${n}(s: any): I { return JSON.parse(JSON.stringify(s)) as I; }`,
    n => `function copy${n}(s: any): unknown { const t: any = {}; for (const k in s) t[k] = s[k]; return t; }`,
    n => `function copy${n}(s: any): unknown { const t: any = new A(); for (const k of Object.keys(s ?? {})) t[k] = s[k]; return t; }`,
    n => `function copy${n}(s: any): unknown { return [{ ...s }, { ...s, q: 1 }].map(x => ({ ...x })); }`,
  ];
  const chosenForms = r.sample(forms, 4 + r.int(5));
  const parts = [look, types];
  chosen.forEach(([name, text], i) => parts.push(`function make${i}(): any { return ${text}; } // ${name}`));
  chosenForms.forEach((f, n) => parts.push(f(n)));
  parts.push(`function typed(o: any): unknown { return o && typeof o === "object" ? [(o as A).a, (o as A).b, (o as A).c, (o as A).d, (o as A).e] : "no object"; }`);
  parts.push(`function told(label: string, f: () => any): void {
  let r: any;
  try { r = f(); } catch (e) { console.log(label + " | THROWS " + (e as Error).constructor.name); return; }
  const list = Array.isArray(r) ? r : [r];
  for (const x of list) console.log(label + " | " + (x !== null && typeof x === "object" ? describe(x) + " # " + Object.keys(x).join() + " # " + attempt(() => JSON.stringify(x)) + " # " + attempt(() => typed(x)) + " # " + (Object.getPrototypeOf(x)?.constructor?.name ?? "none") + " " + Object.isExtensible(x) : show(x)));
}`);
  const pairs: [number, number][] = [];
  const pool = Array.from({ length: 3 + r.int(6) }, () => [r.int(chosenForms.length), r.int(chosen.length)] as [number, number]);
  const length = 30 + r.int(50);
  for (let i = 0; i < length; i++) pairs.push(r.chance(0.8) ? r.pick(pool) : [r.int(chosenForms.length), r.int(chosen.length)]);
  pairs.forEach(([form, maker], i) => {
    if (r.chance(0.03)) parts.push("Bun.gc(true);");
    parts.push(`told("${i} copy${form} of ${chosen[maker][0]}", () => copy${form}(make${maker}()));`);
  });
  return parts.join("\n") + "\n";
}
