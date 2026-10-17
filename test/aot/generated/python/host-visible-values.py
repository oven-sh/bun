#!/usr/bin/env python3
"""host-visible-values.py <seed>: random strict TypeScript programs FOR A WHOLE Bun about what the HOST sees of what compiled code makes: records of declared types (optional members absent, undefined, null; numbers kept as
integers and as doubles; nested; in arrays, Maps, Sets), class instances (fields, private fields, accessors, statics, heirs, heirs of Error | Array | Map), closures of every kind, records with properties beyond their type, frozen ones, rings;
printed by console.log, Bun.inspect, util.inspect (depths, sorted, showHidden, compact), util.format; copied by structuredClone, v8.serialize, a MessageChannel; compared by Bun.deepEquals, util.isDeepStrictEqual, assert.deepStrictEqual;
listed by Object.* and JSON.stringify beside them."""
import random, sys, os

HEAD = r'''import { inspect, format, isDeepStrictEqual } from "node:util";
import { serialize, deserialize } from "node:v8";
import assert from "node:assert";
interface Inner { v: number; label: string }
interface Rec { id: number; ratio: number; name: string; flag: boolean; inner: Inner; maybe?: Inner; orNull: Inner | null; note?: string; count?: number; list: number[]; tags: string[]; children: Rec[] }
type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number; label?: string } | { kind: "none" };
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } norm(): number { return this.x * this.x + this.y * this.y; } get sum(): number { return this.x + this.y; } static origin = new Point(0, 0); }
class Point3 extends Point { z: number; #secret = 7; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } reveal(): number { return this.#secret; } toJSON(): unknown { return { p3: [this.x, this.y, this.z] }; } }
class Named { name = "named"; items: Point[] = []; byName = new Map<string, Point>(); seen = new Set<Point>(); self: Named | null = null; }
class Problem extends Error { code: number; constructor(message: string, code: number) { super(message); this.code = code; this.name = "Problem"; } }
class Stack extends Array<number> { top(): number | undefined { return this[this.length - 1]; } }
class Registry extends Map<string, Inner> { extra = 1; }
class Custom { v = 1; [inspect.custom](): string { return "<custom " + this.v + ">"; } }
function inner(k: number): Inner { return { v: k, label: "i" + k }; }
function rec(k: number, depth: number): Rec {
  const r: Rec = { id: k, ratio: k / 4, name: "rec" + k, flag: k % 2 === 0, inner: inner(k), orNull: k % 3 ? inner(-k) : null, list: [k, k + 0.5], tags: ["t" + k], children: [] };
  if (k % 2) r.maybe = inner(k + 100); if (k % 3 === 0) r.note = "note"; if (k % 4 === 1) r.count = undefined; if (k % 5 === 0) r.count = k;
  if (depth > 0) r.children.push(rec(k + 1, depth - 1), rec(k + 2, depth - 1));
  return r;
}
function shape(k: number): Shape { return k % 3 === 0 ? { kind: "circle", r: k + 0.5 } : k % 3 === 1 ? { kind: "square", side: k, ...(k % 2 ? { label: "sq" } : {}) } : { kind: "none" }; }
function named(k: number): Named { const n = new Named(); const p = new Point(k, 1); n.items.push(p, new Point3(1, 2, k)); n.byName.set("p", p); n.seen.add(p); if (k % 2) n.self = n; return n; }
function noStack(s: string): string { return s.replace(/\n\s+at .*/g, "").replace(/\(?(file:\/\/)?\/[^\s)]*\)?/g, "<path>"); }
function tell(f: () => unknown): string { try { const r = f(); return typeof r === "string" ? r : String(r); } catch (e) { return "threw " + (e as Error).constructor.name + ": " + noStack(String((e as Error).message)).slice(0, 120); } }
const out: string[] = [];
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def value(self):
        r = self.r
        k = r.randint(0, 9)
        return r.choice([
            f"rec({k}, 0)", f"rec({k}, 1)", f"rec({k}, 2)", f"inner({k})", f"shape({k})", f"[shape(0), shape(1), shape(2), shape(3)]", f"new Point({k}, {k}.5)", f"new Point3(1, 2, {k})", f"named({k})", f"Stack.from([1, 2, {k}])", f"new Registry([[\"a\", inner({k})]])", "new Custom()",
            f"[rec({k}, 0), rec({k + 1}, 0)]", f"new Map([[\"a\", rec({k}, 0)]])", f"new Map([[inner({k}), new Point(1, 2)]])", f"new Set([inner({k}), inner({k + 1})])", f"{{ r: rec({k}, 0), p: new Point(1, 2), f: inner }}", f"{{ ...rec({k}, 0), beyond: 1 }}", f"({{ ...inner({k}), ...{{ extra: \"e\", more: [1] }} }} as Inner)",
            f"Object.freeze(inner({k}))", f"Object.freeze(new Point({k}, 0))", "Point", "Point3", "Named", "inner", "rec", "() => 1", "(a: number, b: number) => a + b", "async () => 1", "function* () { yield 1; }", "new Point(1, 2).norm", "inner.bind(null, 1)", "Point.origin", "class {}", "class Local extends Point {}",
            f"[inner, Point, () => {k}]", f"{{ fn() {{ return 1; }}, get g() {{ return 2; }}, set s(v: number) {{}}, [Symbol.for(\"k\")]: inner({k}) }}", f"[1, , 3, inner({k})]", f"[-0, 0, NaN, 1e21, 1.5, {k}, 2147483648]", f"{{ a: -0, b: {k}, c: {k}.5, d: 1e300, e: NaN }}", f"[undefined, null, inner({k}).label, Symbol.for(\"s\"), 10n]",
            f"new Float64Array([{k}, 0.5])", f"new Date(86400000 * {k})", "/a+b/gi", f"Object.assign(Object.create(null), inner({k}))", f"Object.create(inner({k}))", f"new Proxy(inner({k}), {{}})", f"[[[[inner({k})]]]]", f"{{ a: {{ b: {{ c: {{ d: inner({k}) }} }} }} }}", f"new WeakMap([[inner({k}), 1]])", f"Promise.resolve(inner({k}))",
            f"(() => {{ const a = rec({k}, 0); a.children.push(a); return a; }})()", f"(() => {{ const i = inner({k}); return [i, i, {{ i }}]; }})()", f"Object.entries(rec({k}, 0))", f"Object.values(new Point3(1, 2, 3))", f"JSON.parse(JSON.stringify(rec({k}, 1)))", f"new Array<Inner>(3).fill(inner({k}))", f"Array.from({{ length: 120 }}, (_, i) => i)", f"\"x\".repeat(200)",
            f"(function (..._: unknown[]) {{ return arguments; }})(inner({k}), 2)", f"new (class Holder {{ static count = 1; readonly fixed = inner({k}); private hidden = 2; protected prot = 3; }})()", f"Object.defineProperty(inner({k}), \"hid\", {{ value: 1, enumerable: false }})",
        ])

    def row(self, i):
        r = self.r
        v = self.value()
        w = self.value() if r.random() < 0.3 else v
        c = r.random()
        if c < 0.20 and "Problem" not in v: return [f"console.log(\"row {i}\", {v});"]
        if c < 0.34: return [f"out.push(\"row {i} \" + tell(() => noStack(Bun.inspect({v}{r.choice(['', ', { depth: 0 }', ', { depth: 1 }', ', { depth: 5 }', ', { sorted: true }', ', { compact: true }', ', { colors: false }'])}))));"]
        if c < 0.50: return [f"out.push(\"row {i} \" + tell(() => noStack(inspect({v}{r.choice(['', ', { depth: 0 }', ', { depth: 1 }', ', { depth: null }', ', { sorted: true }', ', { showHidden: true }', ', { compact: false }', ', { compact: 1 }', ', { breakLength: 40 }', ', { getters: true }', ', { maxArrayLength: 2 }', ', { numericSeparator: true }'])}))));"]
        if c < 0.58: return [f"out.push(\"row {i} \" + tell(() => noStack(format({r.choice([chr(34) + '%o' + chr(34), chr(34) + '%O' + chr(34), chr(34) + '%j' + chr(34), chr(34) + '%s' + chr(34), chr(34) + '%d %i %f' + chr(34), chr(34) + 'x' + chr(34)])}, {v}, {w}))));"]
        if c < 0.68: return [f"out.push(\"row {i} \" + tell(() => noStack(inspect(structuredClone({v}), {{ depth: 4 }}))));"]
        if c < 0.74: return [f"out.push(\"row {i} \" + tell(() => noStack(inspect(deserialize(serialize({v})), {{ depth: 4 }}))));"]
        if c < 0.84: return [f"out.push(\"row {i} \" + tell(() => {{ const a = {v}, b = {w}; return [Bun.deepEquals(a, b), Bun.deepEquals(a, b, true), isDeepStrictEqual(a, b), Bun.deepEquals(a, a), Bun.deepEquals(a, structuredClone(a)), Bun.deepEquals(a, JSON.parse(JSON.stringify(a))), Bun.deepEquals(a, JSON.parse(JSON.stringify(a)), true)].join(); }}));"]
        if c < 0.89: return [f"out.push(\"row {i} \" + tell(() => {{ assert.deepStrictEqual({v}, {w}); return \"equal\"; }}).split(\"\\n\")[0]);"]
        if c < 0.94: return [('out.push("row ' + str(i) + ' " + tell(() => JSON.stringify(' + str(v) + str(r.choice(['', ', null, 2', ', ["id", "v", "x", "inner"]'])) + ')));')]
        if c < 0.97: return [f"out.push(\"row {i} \" + await new Promise<string>(done => {{ const ch = new MessageChannel(); ch.port2.onmessage = (e: {{ data: unknown }}) => {{ ch.port1.close(); ch.port2.close(); done(noStack(inspect(e.data, {{ depth: 4 }}))); }}; try {{ ch.port1.postMessage({v}); }} catch (e) {{ ch.port1.close(); ch.port2.close(); done(\"threw \" + (e as Error).constructor.name); }} }}));"]
        if "Problem" in v or "Problem" in w: return []
        return [f"console.log(\"row {i} %o | %s\", {v}, {w});"]

    def program(self):
        r = self.r
        L = [f"// host-visible-values.py seed {self.seed}", HEAD]
        for i in range(r.randint(20, 60)):
            L += self.row(i)
        L.append('console.log(out.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
