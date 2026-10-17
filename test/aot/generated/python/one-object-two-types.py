#!/usr/bin/env python3
"""one-object-two-types.py <seed>: random strict TypeScript programs about ONE OBJECT SEEN TWO WAYS: an object that was made without a type (JSON.parse, a literal held as any, Object.assign, structuredClone, an element of any[],
what a function hands back as any | unknown) enters typed code (an annotated variable, a parameter, a result, `as`, a member, an array, a Map, a generic function, a destructured parameter, a callback), nested records, arrays, optional members and unions below
it. Then both holders act in turn: typed stores and reads, untyped stores and reads (always with values the type allows), members added beyond the type, nested objects replaced. After every step both views are printed and identity is asked:
the typed and the untyped holder must still hold the same object, at every level. No value ever contradicts its type: whatever departs from plain Bun is a fault."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
interface Inner { v: number; s: string }
interface Outer { id: number; name: string; inner: Inner; list: Inner[]; opt?: Inner; u: Inner | null; n?: number; flag: boolean; nums: number[] }
interface Holder { o: Outer; spare: Outer | null; all: Outer[] }
function q(x: any, d = 3): string {
  if (x === undefined) return "undef"; if (x === null) return "null"; if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x); if (typeof x === "string") return "'" + x + "'"; if (typeof x !== "object") return String(x);
  if (d <= 0) return ".."; if (Array.isArray(x)) return "[" + x.map(e => q(e, d - 1)).join() + "]";
  return "{" + Object.keys(x).map(k => k + ":" + q(x[k], d - 1)).join() + "}";
}
function readInner(i: Inner): string { return i.v + "/" + i.s; }
function readOuter(o: Outer): string { return [o.id, o.name, readInner(o.inner), o.list.map(readInner).join("+"), o.opt ? readInner(o.opt) : String(o.opt), o.u ? readInner(o.u) : String(o.u), o.n, o.flag, o.nums.join("_")].join(";"); }
function same(t: Outer, raw: any): string { return [t === raw, t.inner === raw.inner, t.list === raw.list, t.list.length === raw.list.length && t.list.every((e, i) => e === raw.list[i]), t.opt === raw.opt, t.u === raw.u, t.nums === raw.nums].map(b => b ? 1 : 0).join(""); }
function both(tag: string, t: Outer, raw: any): void { lines.push(tag + " " + same(t, raw) + " T " + readOuter(t) + " U " + q(raw)); }
function attempt(f: () => void): void { try { f(); } catch (e) { lines.push("THREW " + (e as Error).constructor.name + " " + String((e as Error).message).split(" (bun")[0].slice(0, 90)); } }
function text(k: number): string { return JSON.stringify({ id: k, name: "n" + k, inner: { v: k, s: "i" }, list: [{ v: 1, s: "a" }, { v: 2.5, s: "b" }], u: k % 2 ? { v: -k, s: "u" } : null, flag: k % 2 === 0, nums: [k, 0.5], ...(k % 3 ? { opt: { v: 9, s: "o" } } : {}), ...(k % 4 ? {} : { n: k }) }); }
function identity<T>(x: T): T { return x; }
function takes(o: Outer): Outer { return o; }
function takesParts({ inner, list }: Outer): Inner { return list.length ? list[0] : inner; }
function givesBack(raw: any): Outer { return raw; }
function anyOf(x: unknown): any { return x; }
function makeInner(v: number, s: string): Inner { return { v, s }; }
function makeOuter(k: number): Outer { return { id: k, name: "made" + k, inner: { v: k, s: "i" }, list: [{ v: 1, s: "a" }, makeInner(2.5, "b")], u: k % 2 ? makeInner(-k, "u") : null, flag: k % 2 === 0, nums: [k, 0.5] }; }
function makeWhole(k: number): Outer { const o: Outer = { id: k, name: "full", inner: makeInner(0.5, ""), list: [], opt: { v: 9, s: "o" }, u: { v: 3, s: "u" }, n: 4, flag: false, nums: [] }; return o; }
class Impl implements Outer { id: number; name = "impl"; inner: Inner; list: Inner[] = []; opt?: Inner; u: Inner | null = null; n?: number; flag = true; nums: number[] = []; constructor(k: number) { this.id = k; this.inner = makeInner(k, "c"); } }
const kept: Outer[] = [];
const byName = new Map<string, Outer>();
const seen = new Set<Outer>();
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.typed_share = self.r.choice([0.0, 0.5, 0.5, 1.0, 1.0])

    def source(self):
        r = self.r
        lit = '{ id: k, name: "n" + k, inner: { v: k, s: "i" }, list: [{ v: 1, s: "a" }, { v: 2.5, s: "b" }], u: null, flag: true, nums: [k, 0.5] }'
        lit2 = '{ id: k, name: "m", inner: { v: 0.5, s: "" }, list: [], opt: { v: 9, s: "o" }, u: { v: 3, s: "u" }, n: 4, flag: false, nums: [] }'
        if r.random() < self.typed_share:
            return r.choice(["makeOuter(k)", "makeOuter(k)", "makeWhole(k)", "makeOuter(k + 1)", "{ ...makeOuter(k) }", "Object.assign(makeWhole(k), { beyond: 1 })", "[makeOuter(k), makeWhole(k)][k % 2]", "identity(makeOuter(k))", "new Impl(k)", "anyOf(makeWhole(k))",
                             "(() => { const o = makeOuter(k); o.list.push(o.inner); return o; })()", "(() => { const o = makeWhole(k); o.u = o.opt ?? null; return o; })()", "Object.assign({}, makeOuter(k))", "{ ...makeWhole(k), inner: makeInner(1, \"z\") }"])
        return r.choice([
            "JSON.parse(text(k))", "JSON.parse(text(k))", "JSON.parse(text(k + 1))", lit, lit2, f"Object.assign({{}}, {lit})", f"structuredClone({lit2})" if False else f"Object.assign({{}}, {lit2})", f"[{lit}, {lit2}][k % 2]", f"anyOf({lit})", f"{{ ...{lit}, beyond: 1 }}", f"{{ ...JSON.parse(text(k)) }}",
            f"Object.assign(JSON.parse(text(k)), {{ beyond: \"b\" }})", f"(() => {{ const o: any = {{}}; o.id = k; o.name = \"late\"; o.inner = {{ v: 1, s: \"l\" }}; o.list = []; o.u = null; o.flag = true; o.nums = [1]; return o; }})()",
            f"(() => {{ const o: any = {lit}; o.list.push(o.inner); return o; }})()", f"(() => {{ const o: any = {lit2}; o.u = o.opt; return o; }})()", "JSON.parse(\"[\" + text(k) + \"]\")[0]", "JSON.parse(\"{\\\"w\\\":\" + text(k) + \"}\").w",
        ])

    def entry(self):
        r = self.r
        return r.choice([
            "const t: Outer = raw;", "const t = raw as Outer;", "const t = takes(raw);", "const t = givesBack(raw);", "const t = identity<Outer>(raw);", "const h: Holder = { o: raw, spare: null, all: [] }; const t = h.o;", "const h: Holder = { o: raw, spare: raw, all: [raw] }; const t = h.all[0];",
            "kept.push(raw); const t = kept[kept.length - 1];", "byName.set(\"k\" + k, raw); const t = byName.get(\"k\" + k)!;", "const arr: Outer[] = [raw]; const t = arr[0];", "const [t]: Outer[] = [raw];", "let t: Outer = JSON.parse(text(99)); t = raw;", "const t = [raw].map((o: Outer) => o)[0];",
            "const t = ((o: Outer): Outer => o)(raw);", "const t: Outer = (raw as unknown) as Outer;", "seen.add(raw); const t = [...seen].pop()!;", "const t: Outer = k > -1 ? raw : JSON.parse(text(0));", "const box: { value: Outer } = { value: raw }; const t = box.value;", "const t: Readonly<Outer> & Outer = raw;",
            "const t = (raw satisfies any) as Outer;", "const wrap = (): Outer => raw; const t = wrap();", "const t = Object.freeze([raw as Outer])[0];",
        ])

    def step(self, i):
        r = self.r
        inner = r.choice(['{ v: k + %d, s: "x%d" }' % (i, i), '{ v: %d.5, s: "" }' % i])
        return r.choice([
            f"t.id = {i};", "t.id++;", f"t.name = \"t{i}\";", f"t.inner.v = {i};", f"t.inner.v += 0.5;", f"t.inner.s += \"!\";", f"t.inner = {inner};", f"t.list.push({inner});", "t.list.pop();", f"t.list[0] = {inner};", f"if (t.list.length) t.list[0].v = {i};", f"t.opt = {inner};", "t.opt = undefined;", "delete t.opt;",
            f"t.u = {inner};", "t.u = null;", "t.u = t.inner;", f"t.n = {i};", "t.n = undefined;", "delete t.n;", "t.flag = !t.flag;", f"t.nums.push({i});", f"t.nums = [{i}, {i}.5];", "t.nums.length = 0;", "t.list = [];", "t.list = [t.inner];", "t.list.reverse();", "if (t.opt) t.opt.v++;", "if (t.u) t.u.s = \"U\";",
            f"raw.id = {i};", f"raw.name = \"r{i}\";", f"raw.inner.v = {i};", f"raw.inner.s = \"R\";", f"raw.inner = {inner};", f"raw.list.push({inner});", "raw.list.pop();", f"raw.list[0] = {inner};", f"raw.opt = {inner};", "delete raw.opt;", "raw.opt = undefined;", f"raw.u = {inner};", "raw.u = null;", f"raw.n = {i};", "delete raw.n;",
            "raw.flag = !raw.flag;", f"raw.nums.push({i});", f"raw.nums = [{i}];", "raw.list = [];", f"raw.beyond = {i};", "delete raw.beyond;", f"raw.inner.extra = {i};", f"raw[\"id\"] = {i};", f"raw[\"in\" + \"ner\"].v = {i};", "raw.u = raw.inner;", "raw.list = [raw.inner, raw.inner];",
            "collect();", "lines.push(readInner(takesParts(t)) + (takesParts(t) === (raw.list.length ? raw.list[0] : raw.inner)));", "lines.push(String(kept.includes(t)) + kept.indexOf(raw) + seen.has(raw) + seen.has(t));", "lines.push(q({ ...t }) + q({ ...raw }));", "lines.push(JSON.stringify(t) === JSON.stringify(raw) ? \"json same\" : \"JSON DIFFERS\");",
            "lines.push(Object.keys(t).join() + \"|\" + Object.keys(raw).join());", "{ const i2: Inner = raw.inner; i2.v = -1; lines.push(String(i2 === t.inner)); }", "{ const l2: Inner[] = raw.list; l2.push({ v: 7, s: \"l2\" }); lines.push(String(l2 === t.list)); }", "{ const t2: Outer = raw; t2.id = 77; lines.push(String(t2 === t)); }",
            "{ const u2: any = t; u2.id = 78; lines.push(String(u2 === raw)); }", "{ const u3: any = t.inner; u3.v = 79; u3.more = 1; lines.push(String(u3 === raw.inner)); }", "for (const e of t.list) e.v++;", "for (const e of raw.list) e.v--;", "t.list.forEach((e, j) => { e.s = e.s + j; });", "Object.assign(t.inner, { v: 11 });", "Object.assign(raw.inner, { v: 12, s: \"as\" });",
            "[t.inner, t.u] = [t.u ?? t.inner, t.inner];", "{ const { inner, ...rest } = t; inner.v = 13; lines.push(q(rest, 1)); }",
        ])

    def case(self, c):
        r = self.r
        L = [f"function case{c}(k: number): void {{", f"  const raw: any = {self.source()};", f"  {self.entry()}", f"  both(\"{c}.start\", t, raw);"]
        for i in range(r.randint(2, 9)):
            L.append(f"  attempt(() => {{ {self.step(i + 1)} }}); both(\"{c}.{i}\", t, raw);")
        L.append("}")
        return L

    def program(self):
        r = self.r
        L = [f"// one-object-two-types.py seed {self.seed}", HEAD]
        n = r.randint(6, 16)
        for c in range(n): L += self.case(c)
        L.append(f"for (let k = 0; k < {r.choice([2, 3, 5])}; k++) {{")
        for c in range(n): L.append(f"  attempt(() => case{c}(k));")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
