// Class fields initialized with string constants and built-in functions: loading such a constant may allocate, which must not happen between an object's allocation and its initializing stores.
export {};
class Named { name = "a name"; kind: string; other = "other"; n = 1; constructor(kind: string) { this.kind = kind; } }
class Derived extends Named { more = "more"; fn = Math.max; constructor() { super("derived"); } }
class WithFunctions { a = Math.floor; b = Array.isArray; c = "text"; d = parseInt; }
interface Pair { first: string; second: string; n: number }
type Tagged = { tag: "x"; value: string } | { tag: "y"; value: number };
function record(n: number): Pair { return { first: "first", second: "second", n }; }
function tagged(n: number): Tagged { return n & 1 ? { tag: "x", value: "odd" } : { tag: "y", value: n }; }
function nested(n: number) { return { outer: "outer", inner: { deep: "deep", list: ["l0", "l1", "l2"], n }, after: "after" }; }
function strings(): string[] { return ["zero", "one", "two", "three", "four", "five"]; }
function mixed(n: number): (string | number)[] { return ["s", n, "t", n + 1]; }
function functions() { return [Math.min, Math.max, String, "between", Number]; }
function tuple(n: number): [string, number, string] { return ["left", n, "right"]; }
function closure(n: number) { const s = "captured", f = Math.abs, t = "too"; return () => s + f(-n) + t; }
function map() { return new Map<string, string>([["k1", "v1"], ["k2", "v2"]]); }
function set() { return new Set<string>(["m1", "m2", "m3"]); }
function* generator(n: number) { const s = "kept over a yield"; yield "first yield"; yield s + n; }
async function asynchronous(n: number) { const s = "kept over an await"; await null; return s + n; }
function template(n: number) { return { text: `t${n}`, plain: "plain", joined: "a" + "b" }; }
function spread(p: Pair) { return { ...p, added: "added", second: "replaced" }; }
function conditional(c: boolean) { return { a: c ? "yes" : "no", b: c ? Math.ceil : Math.round, c: "always" }; }
function argumentsOf(...rest: string[]) { return rest.join(); }
function compared(s: string, o: Named) { return s === "a name" ? o.name === s : o.kind === "derived" || s === "other"; }
let sum = 0; const kept: unknown[] = [];
for (let i = 0; i < 60000; i++) {
  const n = new Named("kind"), d = new Derived(), w = new WithFunctions(), r = record(i), t = tagged(i), ne = nested(i), s = strings(), m = mixed(i), f = functions(), tu = tuple(i), c = closure(i), te = template(i), sp = spread(r), co = conditional((i & 1) === 0);
  sum += n.name.length + n.kind.length + n.other.length + d.more.length + d.kind.length + d.fn(1, 2) + w.a(1.5) + (w.b(s) ? 1 : 0) + w.c.length + w.d("7") + r.first.length + r.second.length + t.tag.length + String(t.value).length + ne.outer.length + ne.inner.deep.length + ne.inner.list[2].length + ne.after.length
    + s[5].length + String(m[2]).length + (f[0] as typeof Math.min)(3, 4) + String(f[3]).length + tu[0].length + tu[2].length + c().length + te.text.length + te.plain.length + te.joined.length + sp.added.length + sp.second.length + sp.first.length + co.a.length + co.b(1.4) + co.c.length + argumentsOf("p", "q", "r").length + (compared(n.name, d) ? 1 : 0) + (compared("other", n) ? 1 : 0);
  if ((i & 1023) === 0) { const ma = map(), se = set(); sum += ma.get("k2")!.length + se.size + [...generator(i)].join().length; kept.push(n, d, w, r, t, ne, s, m, f, tu, c, ma, se, te, sp, co); }
}
console.log(sum, kept.length, JSON.stringify(kept.slice(0, 10)).length, JSON.stringify(kept[kept.length - 16]), JSON.stringify(kept[kept.length - 11]), (kept[kept.length - 6] as () => string)());
asynchronous(5).then(v => console.log(v));
