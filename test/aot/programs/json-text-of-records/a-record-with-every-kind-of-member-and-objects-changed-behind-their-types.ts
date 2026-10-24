// JSON.stringify of a record with every kind of member, with indentation, a list of keys and a replacer, and of typed objects that were changed behind their types: names added late, deleted and put back, made non-enumerable, made accessors, a toJSON that changes its holder, cycles, holes, boxed primitives, inherited names.
type Inner = { x: number; y?: string; z: number | null };
type Rec = { id: number; name: string; ok: boolean; tags: string[]; inner: Inner; opt?: number; nul: null; list: Inner[]; any: unknown; u: undefined | number; d: Date; big?: bigint; f?: () => void; s?: symbol; nums: number[]; m: Record<string, number> };
function mk(i: number): Rec {
  return { id: i, name: "n" + i, ok: i % 2 === 0, tags: ["a", "b\"c", "  ", "\ud800", "\udc00x", "\u0000\u001f\u007f", "é😀", "</script>", "\\"], inner: { x: -0, z: null }, nul: null, list: [{ x: NaN, y: "q", z: 1 }, { x: Infinity, z: -1e21 }, { x: 1e-7, y: undefined, z: 0.1 + 0.2 }], any: i, u: undefined, d: new Date(86400000 * i), nums: [1, 2.5, -0, 1e21, 123456789012345680000, 5e-324, 1.7976931348623157e308, 4294967296, -2147483649], m: { b: 1, a: 2, 10: 3, 2: 4 } };
}
console.log(JSON.stringify(mk(1)));
console.log(JSON.stringify(mk(2), null, 2).length, JSON.stringify(mk(2), null, "\t").length, JSON.stringify(mk(2), ["id", "inner", "x"]), JSON.stringify(mk(3), (k, v) => (typeof v === "number" ? v + 1 : v)).length);
const withF: Rec = mk(4); withF.f = () => {}; withF.s = Symbol("s"); withF.opt = 5; withF.u = 6; console.log(JSON.stringify(withF));
const withBig: Rec = mk(5); withBig.big = 5n; try { console.log(JSON.stringify(withBig)); } catch (e: any) { console.log(e.constructor.name, e.message); }
class P { constructor(public a: number, public b: string) {} toJSON() { return { A: this.a }; } }
class Q { constructor(public a: number, public p: P) {} }
console.log(JSON.stringify(new Q(1, new P(2, "x"))), JSON.stringify([new P(3, "y")]), JSON.stringify({ k: new P(4, "z") }));
class G { _v = 1; get v() { return this._v + 1; } w = 2; }
console.log(JSON.stringify(new G()));
type Cyc = { n: number; next?: Cyc }; const c: Cyc = { n: 1 }; c.next = c; try { JSON.stringify(c); } catch (e: any) { console.log(e.constructor.name, e.message.split("\n")[0]); }
const holes: (number | undefined)[] = [1, , 3]; console.log(JSON.stringify(holes), JSON.stringify({ h: holes }));
type Added = { a: number }; const ad: Added = { a: 1 }; (ad as any).late = 2; (ad as any)[5] = "five"; console.log(JSON.stringify(ad));
const del: { a?: number; b: number; c: number } = { a: 1, b: 2, c: 3 }; delete del.a; del.a = 9; console.log(JSON.stringify(del));
const ne: { a: number; b: number } = { a: 1, b: 2 }; Object.defineProperty(ne, "a", { enumerable: false }); console.log(JSON.stringify(ne));
const acc: { a: number; b: number } = { a: 1, b: 2 }; let hits = 0; Object.defineProperty(acc, "b", { get() { hits++; return 42; }, enumerable: true }); console.log(JSON.stringify(acc), hits);
const boxed: { n: any; s: any; b: any } = { n: new Number(3), s: new String("str"), b: new Boolean(false) }; console.log(JSON.stringify(boxed));
const proto: { own: number } = Object.create({ inherited: 1 }); proto.own = 2; console.log(JSON.stringify(proto));
const frozen = Object.freeze({ a: 1, b: [1, 2] as number[] }); console.log(JSON.stringify(frozen));
const deep: any[] = []; let cur: any = deep; for (let i = 0; i < 50; i++) { const n: any[] = []; cur.push(n); cur = n; } console.log(JSON.stringify(deep).length);
const mutating: { a: { toJSON(): number }; b: number } = { a: { toJSON() { (mutating as any).b = 99; delete (mutating as any).c; return 1; } }, b: 2 }; (mutating as any).c = 3; console.log(JSON.stringify(mutating));
console.log(JSON.stringify({ a: [] as number[], b: {} , c: "" , d: [[]] as number[][] }), JSON.stringify("\ud83d"), JSON.stringify(undefined), JSON.stringify(() => {}), JSON.stringify(null), JSON.stringify(-0), JSON.stringify([undefined, function () {}, Symbol()]));
const typedArr: { t: Uint8Array; m: Map<string, number>; s: Set<number>; r: RegExp; e: Error } = { t: new Uint8Array([1, 2]), m: new Map([["a", 1]]), s: new Set([1]), r: /x/g, e: new Error("boom") }; console.log(JSON.stringify(typedArr));
function many(n: number) { let t = 0; for (let i = 0; i < n; i++) t += JSON.stringify(mk(i)).length; return t; } console.log(many(200));
