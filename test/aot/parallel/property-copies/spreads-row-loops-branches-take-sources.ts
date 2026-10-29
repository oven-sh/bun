// Spreads in a row in loops and behind branches take sources of every kind.
interface O { a: number; b: number; c: number }
interface R { name: string; tags: string[]; inner: O | null; n: number }
interface M { a: number; f(): number; g: () => number }
const log: string[] = [];
const mark = Symbol("mark");
function describe(o: any): string {
  if (o === null || typeof o !== "object") return String(o);
  const parts: string[] = [];
  for (const k of Reflect.ownKeys(o)) {
    const d = Object.getOwnPropertyDescriptor(o, k)!;
    const v = "value" in d ? (typeof d.value === "function" ? "fn" : typeof d.value === "object" && d.value !== null ? describe(d.value) : Object.is(d.value, -0) ? "-0" : String(d.value)) : "accessor";
    parts.push(String(k) + ":" + v + (d.enumerable ? "e" : "-") + (d.writable ? "w" : "-") + (d.configurable ? "c" : "-"));
  }
  return (Array.isArray(o) ? "[" : "{") + parts.join(",") + "}" + (Object.getPrototypeOf(o) === Object.prototype || Array.isArray(o) ? "" : "!proto") + (Object.isExtensible(o) ? "" : "!ext");
}
function plain(): O { return { a: 1, b: 2, c: 3 }; }
class P3 { a = 1; b = 2; c = 3; get d() { return 4; } }
const makers: [string, () => any][] = [
  ["plain", plain],
  ["another order", () => ({ c: 3, a: 1, b: 2 })],
  ["built by stores", () => { const o: any = {}; o.b = 2; o.c = 3; o.a = 1; return o; }],
  ["deleted b", () => { const o: any = plain(); delete o.b; return o; }],
  ["deleted and added again", () => { const o: any = plain(); delete o.a; o.a = 10; return o; }],
  ["one more", () => { const o: any = plain(); o.z = 26; return o; }],
  ["an index", () => { const o: any = plain(); o[0] = "zero"; o[7] = "seven"; return o; }],
  ["a symbol", () => { const o: any = plain(); o[mark] = "marked"; return o; }],
  ["a hidden symbol", () => { const o: any = plain(); Object.defineProperty(o, mark, { value: 1, enumerable: false }); return o; }],
  ["a getter", () => { const o: any = plain(); Object.defineProperty(o, "b", { get() { log.push("get b"); return 22; }, enumerable: true, configurable: true }); return o; }],
  ["a getter that changes c", () => { const o: any = plain(); Object.defineProperty(o, "a", { get() { log.push("get a"); o.c = 33; return 11; }, enumerable: true, configurable: true }); return o; }],
  ["a getter that deletes c", () => { const o: any = plain(); Object.defineProperty(o, "a", { get() { log.push("get a"); delete o.c; return 11; }, enumerable: true, configurable: true }); return o; }],
  ["a getter that throws", () => { const o: any = plain(); Object.defineProperty(o, "c", { get() { throw new Error("no c"); }, enumerable: true, configurable: true }); return o; }],
  ["not enumerable", () => { const o: any = plain(); Object.defineProperty(o, "b", { enumerable: false }); return o; }],
  ["read only", () => { const o: any = plain(); Object.defineProperty(o, "a", { writable: false }); return o; }],
  ["frozen", () => Object.freeze(plain())],
  ["sealed", () => Object.seal(plain())],
  ["not extensible", () => Object.preventExtensions(plain())],
  ["a text in a", () => { const o: any = plain(); o.a = "text"; return o; }],
  ["undefined in b", () => { const o: any = plain(); o.b = undefined; return o; }],
  ["null in c", () => { const o: any = plain(); o.c = null; return o; }],
  ["fractions", () => ({ a: 0.5, b: -0, c: NaN })],
  ["large", () => ({ a: 2 ** 31, b: -(2 ** 31) - 1, c: 2 ** 53 })],
  ["an object in a", () => { const o: any = plain(); o.a = { deep: 1 }; return o; }],
  ["another prototype", () => Object.setPrototypeOf(plain(), { inherited: 1 })],
  ["no prototype", () => Object.setPrototypeOf(plain(), null)],
  ["is a prototype", () => { const o = plain(); Object.create(o); return o; }],
  ["own __proto__", () => { const o: any = plain(); Object.defineProperty(o, "__proto__", { value: { evil: 1 }, enumerable: true, writable: true, configurable: true }); return o; }],
  ["an instance", () => new P3()],
  ["a proxy", () => new Proxy(plain(), { ownKeys(t) { log.push("ownKeys"); return Reflect.ownKeys(t).reverse(); }, get(t, k, r) { log.push("get " + String(k)); return Reflect.get(t, k, r); }, getOwnPropertyDescriptor(t, k) { log.push("gopd " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })],
  ["empty", () => ({})],
  ["only a", () => ({ a: 1 })],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 5],
  ["a text", () => "xy"],
  ["a list", () => [7, 8]],
  ["a copy of a copy", () => ({ ...{ ...plain(), a: 5 }, b: 6 })],
  ["parsed", () => JSON.parse('{"a":1,"b":2,"c":3}')],
  ["parsed in another order", () => JSON.parse('{"b":2,"c":3,"a":1,"d":4}')],
  ["assigned", () => Object.assign({}, plain(), { b: 8 })],
];
function chain(p: O): O { p = { ...p, a: 1 }; p = { ...p, b: 2 }; p = { ...p, c: 3 }; p = { ...p, a: 4 }; return p; }
function chainOfCopies(p: O): O { p = { ...p }; p = { ...p }; p = { ...p }; return p; }
function chainRead(p: O): string { const q = { ...p, a: 1 }; const r = { ...q, b: 2 }; return r.a + "," + r.b + "," + r.c; }
function readOnly(p: O): string { const q = { ...p }; return q.a + "," + q.b + "," + q.c; }
function keysOfDropped(p: O): string { const q = { ...p, b: 5 }; return Object.keys(q).join(); }
function keptOne(p: O, i: number): O { return { ...p, b: i }; }
function keptNothing(p: O): O { return { ...p }; }
function keptTwo(p: O, i: number): O { return { ...p, c: i, a: i + 1 }; }
function behindBranch(p: O, f: boolean): O { let q: O; if (f) q = { ...p, a: 7 }; else q = { ...p }; return { ...q, c: 9 }; }
function droppedBehindBranch(p: O, f: boolean): string { let q: O; if (f) q = { ...p, a: 7 }; else q = { ...p, b: 8 }; const r = { ...q, c: 9 }; return r.a + "," + r.b + "," + r.c; }
function inLoop(p: O, n: number): string { let s = ""; for (let i = 0; i < n; i++) { const q = { ...p, b: i }; s += q.a + "," + q.b + "," + q.c + ";"; } return s; }
function sumInLoop(p: O, n: number): number { let s = 0; for (let i = 0; i < n; i++) { const q = { ...p, b: i }; s += q.a + q.b + q.c; } return s; }
function loopCarried(p: O, n: number): O { for (let i = 0; i < n; i++) p = { ...p, a: i }; return p; }
function loopCarriedChain(p: O, n: number): O { for (let i = 0; i < n; i++) { p = { ...p, a: i }; p = { ...p, b: i }; } return p; }
function twoSources(p: O, q: O): O { return { ...p, ...q }; }
function twoSourcesDropped(p: O, q: O): string { const r = { ...p, ...q, b: 1 }; return r.a + "," + r.b + "," + r.c; }
function memberInFront(p: Partial<O>): Partial<O> { return { a: 0, ...p }; }
function nested(p: { x: O; y: O }): { x: O; y: O } { return { ...p, x: { ...p.x, a: 5 } }; }
function changedAfter(p: O): string { const q = { ...p, a: 1 }; q.b = 50; (q as any).w = 1; return describe(q) + " from " + describe(p); }
function inTry(p: O): string { try { const q = { ...p, a: 1 }; const r = { ...q, b: 2 }; return describe(r); } catch (e) { return "caught " + (e as Error).message; } }
let kept: O = plain();
function keptInVariable(p: O, i: number): string { kept = p; kept = { ...kept, b: i & 7 }; kept = { ...kept }; return describe(kept); }
const ring: O[] = [];
function keptInRing(p: O, i: number): void { ring[i & 3] = { ...p, c: i }; }
function attempt(name: string, f: () => any): void {
  log.length = 0;
  let out: string;
  try { const v = f(); out = typeof v === "string" ? v : describe(v); } catch (e) { out = "threw " + (e as Error).message; }
  console.log(name + " = " + out + (log.length ? " | " + log.join(" ") : ""));
}
for (const [name, make] of makers) {
  console.log("## " + name);
  attempt("chain", () => chain(make()));
  attempt("chainOfCopies", () => chainOfCopies(make()));
  attempt("chainRead", () => chainRead(make()));
  attempt("readOnly", () => readOnly(make()));
  attempt("keysOfDropped", () => keysOfDropped(make()));
  attempt("keptOne", () => keptOne(make(), 9));
  attempt("keptNothing", () => keptNothing(make()));
  attempt("keptTwo", () => keptTwo(make(), 9));
  attempt("behindBranch t", () => behindBranch(make(), true));
  attempt("behindBranch f", () => behindBranch(make(), false));
  attempt("droppedBehindBranch t", () => droppedBehindBranch(make(), true));
  attempt("droppedBehindBranch f", () => droppedBehindBranch(make(), false));
  attempt("inLoop", () => inLoop(make(), 3));
  attempt("sumInLoop", () => String(sumInLoop(make(), 5)));
  attempt("loopCarried 0", () => loopCarried(make(), 0));
  attempt("loopCarried 3", () => loopCarried(make(), 3));
  attempt("loopCarriedChain", () => loopCarriedChain(make(), 2));
  attempt("twoSources p", () => twoSources(make(), plain()));
  attempt("twoSources q", () => twoSources(plain(), make()));
  attempt("twoSourcesDropped", () => twoSourcesDropped(plain(), make()));
  attempt("memberInFront", () => memberInFront(make()));
  attempt("nested", () => nested({ x: make(), y: make() }));
  attempt("changedAfter", () => changedAfter(make()));
  attempt("inTry", () => inTry(make()));
  attempt("keptInVariable", () => keptInVariable(make(), 13));
  attempt("keptInRing", () => { for (let i = 0; i < 6; i++) keptInRing(make(), i); return describe(ring); });
}
function record(i: number): R { return { name: "n" + i, tags: ["t" + i, "u"], inner: i & 1 ? { a: i, b: i, c: i } : null, n: i }; }
function renamed(r: R, i: number): R { return { ...r, name: r.name + "'" + i }; }
function copied(r: R): R { return { ...r }; }
let held: R[] = [];
let sum = 0;
for (let i = 0; i < 60000; i++) {
  let r = record(i);
  r = renamed(r, i & 3);
  r = copied(r);
  held[i & 255] = r;
  if ((i & 8191) === 0) Bun.gc(true);
  const h = held[(i * 7) & 255];
  if (h) sum = (sum + h.n + h.name.length + h.tags[0].length + (h.inner ? h.inner.b : 1)) | 0;
}
console.log("records", sum, describe(held[3]), held[3].tags === copied(held[3]).tags);
function methods(i: number): M { return { a: i, f() { return this.a + 1; }, g: () => i + 2 }; }
function copyOfMethods(m: M): M { return { ...m }; }
function copyOfMethodsWith(m: M, i: number): M { return { ...m, a: i }; }
for (let i = 0; i < 3; i++) {
  const m = methods(i);
  const c = copyOfMethods(m);
  const d = copyOfMethodsWith(m, 40);
  console.log("methods", c.f === m.f, c.g === m.g, d.f === m.f, c.f(), c.g(), d.f(), d.g(), describe(c), describe(d));
}
