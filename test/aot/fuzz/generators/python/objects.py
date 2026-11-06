#!/usr/bin/env python3
"""objects.py <seed>: random strict TypeScript programs about objects used as objects: literals, records of declared types, class instances, dictionaries grown and shrunk key by key (into dictionary mode),
objects with index keys, symbols, accessors, hidden and read-only properties, prototypes with properties of their own, null prototypes, frozen | sealed | non-extensible objects, arrays, functions with properties; read, stored to, deleted from and
asked by keys that are there, absent, inherited, text of numbers, numbers, symbols; listed by keys | values | entries | for-in | getOwnPropertyNames | Reflect.ownKeys | JSON.stringify | spread | assign | fromEntries; the order of keys after every change;
truthiness and typeof of what is read."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
const sym = Symbol.for("sym"), other = Symbol.for("other");
function q(x: unknown, d = 2): string {
  if (x === undefined) return "undef"; if (x === null) return "null";
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "string") return "'" + x + "'"; if (typeof x === "symbol") return x.toString(); if (typeof x === "function") return "fn";
  if (typeof x !== "object") return String(x);
  if (d <= 0) return "..";
  if (Array.isArray(x)) return "[" + x.map(e => q(e, d - 1)).join() + "]";
  return "{" + Reflect.ownKeys(x).map(k => String(k) + ":" + q((Object.getOwnPropertyDescriptor(x, k) as PropertyDescriptor).get ? "accessor" : (x as any)[k], d - 1)).join() + "}";
}
function attempt(f: () => unknown): string { try { return q(f()); } catch (e) { return "threw " + (e as Error).constructor.name; } }
function listed(o: any): string {
  const forIn: string[] = []; for (const k in o) forIn.push(k);
  return [Object.keys(o).join("+"), forIn.join("+"), q(Object.values(o)), q(Object.entries(o)), Object.getOwnPropertyNames(o).join("+"), Reflect.ownKeys(o).map(String).join("+"), JSON.stringify(o), q({ ...o }), q(Object.assign({}, o))].join(" | ");
}
interface Rec { a: number; b: string; c?: number; d: Rec | null }
class Base { x = 1; y = "y"; get acc(): number { return this.x * 2; } set acc(v: number) { this.x = v; } method(): number { return this.x; } static s = 5; }
class Derived extends Base { z = [1]; override method(): number { return super.method() + 1; } }
function truth(x: unknown): string { return (x ? "T" : "F") + (!x ? "f" : "t") + (x && 1 ? "1" : "0") + (x || 0 ? "1" : "0") + typeof x; }
'''
KEYS = ['"a"', '"b"', '"c"', '"x"', '"y"', '"z"', '"zz"', '"0"', '"1"', '"10"', '"-1"', '"1.5"', '"01"', "0", "1", "2", "10", "-1", "1.5", "sym", "other", '"acc"', '"method"', '"inherited"', '"toString"', '"constructor"', '"__proto__"', '"length"', '""', '"k" + k', '"n" + (k % 3)', "k",
        '"hidden"', '"ro"', '"4294967295"', '"4294967294"', "4294967295"]
VALS = ["1", "2.5", '"s"', "null", "undefined", "true", "false", "0", '""', "NaN", "-0", "[1]", "{ q: 1 }", "k", '"v" + k', "sym", "0n", "1n"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def maker(self):
        r = self.r
        return r.choice([
            "{ a: 1, b: \"two\", c: 3 }", "{}", "{ b: 1, a: 2 }", "{ a: 1, 1: \"one\", b: 2, 0: \"zero\", [sym]: \"s\" }", "grown(k + 3)", "grown(70)", "shrunk(12)", "shrunk(80)",
            "Object.create({ inherited: 1, a: \"proto a\" })", "Object.assign(Object.create({ inherited: 1 }), { own: 2 })", "Object.create(null)", "Object.assign(Object.create(null), { a: 1 })", "Object.freeze({ a: 1, b: [1] })", "Object.seal({ a: 1, b: 2 })", "Object.preventExtensions({ a: 1 })",
            "withAccessors()", "withHidden()", "[1, 2, 3]", "Object.assign([1, 2], { extra: 1 })", "JSON.parse('{\"a\":1,\"b\":{\"c\":2},\"1\":3,\"__proto__\":4}')", "Object.fromEntries([[\"a\", 1], [\"b\", 2], [\"a\", 3]])", "new Map([[1, 2]])", "\"str\"", "Object(\"str\")", "Object(5)",
            "{ a: undefined, b: null, c: NaN }", "{ toString() { return \"custom\"; }, valueOf() { return 7; } }", "{ __proto__: { inherited: 2 }, a: 1 }", "{ \"__proto__x\": 1, [\"__proto__\"]: 2 }",
        ])

    def op(self):
        r = self.r
        k, k2, v = r.choice(KEYS), r.choice(KEYS), r.choice(VALS)
        return r.choice([
            f"o[{k}]", f"o[{k}]", f"truth(o[{k}])", f"({k}) in Object(o)", f"Object.hasOwn(o, {k})", f"(o[{k}] = {v}, o[{k}])", f"(o[{k}] = {v}, listed(o))", f"delete o[{k}]", f"(delete o[{k}], listed(o))", "listed(o)", f"Object.getOwnPropertyDescriptor(o, {k})", f"o[{k}]?.[{k2}]",
            f"(Object.defineProperty(o, {k}, {{ value: {v}, enumerable: {r.choice(['true', 'false'])}, writable: {r.choice(['true', 'false'])}, configurable: true }}), listed(o))", f"(Object.defineProperty(o, {k}, {{ get() {{ return {v}; }}, enumerable: true, configurable: true }}), listed(o))",
            "Object.isFrozen(o) + \"\" + Object.isSealed(o) + Object.isExtensible(o)", "(Object.freeze(o), listed(o))", f"(Object.setPrototypeOf(o, {{ inherited: {v} }}), listed(o))", "Object.getPrototypeOf(o) === Object.prototype", f"Object.entries(o).map(e => e[0] + \"=\" + q(e[1])).join()", f"Object.entries(o).length + Object.keys(o).length",
            f"Object.fromEntries(Object.entries(o))", f"Object.assign(o, {{ [{k}]: {v} }})", f"({{ ...o, [{k}]: {v} }})", f"String(o)", f"`${{o}}`", f"o + \"\"", f"typeof o[{k}]", f"o[{k}] === o[{k2}]", f"o.a", f"o.zz", f"o.a?.b", f"(o.a = {v}, o.a)", f"(o.fresh = {v}, Object.keys(o).join())", f"o.method?.()", f"o.acc",
            f"(o.acc = 9, [o.acc, o.x])", f"Object.keys(o).sort().join()", f"JSON.stringify(o, [{k if k.startswith(chr(34)) else chr(34) + 'a' + chr(34)}, \"b\"])", f"JSON.stringify(o, (key, val) => typeof val === \"number\" ? val + 1 : val)", f"JSON.stringify(o, null, 1)", f"Object.getOwnPropertySymbols(o).length",
            f"o.hasOwnProperty?.({k})", f"o.propertyIsEnumerable?.({k})", f"(o[{k}] ??= {v})", f"(o[{k}] ||= {v})", f"(o[{k}]++, o[{k}])", f"Reflect.get(o, {k})", f"Reflect.set(o, {k}, {v})", f"Reflect.has(Object(o), {k})", f"Reflect.deleteProperty(Object(o), {k})",
        ])

    def function(self, i):
        r = self.r
        L = [f"function f{i}(k: number): void {{", f"  const o: any = {self.maker()};"]
        for _ in range(r.randint(3, 12)):
            L.append(f"  lines.push(attempt(() => {self.op()}));")
            if r.random() < 0.05: L.append("  collect();")
        if r.random() < 0.3:
            L.append(f"  for (let i = 0; i < {r.choice([3, 20, 70])}; i++) {{ attempt(() => {{ o[\"g\" + i] = i; }}); if (i % 3 === 0) attempt(() => delete o[\"g\" + (i >> 1)]); lines.push(attempt(() => o[\"g\" + (i - 1)]) + attempt(() => o[\"absent\" + i])); }}")
        L.append("  lines.push(attempt(() => listed(o)));")
        L.append("}")
        return L

    def program(self):
        r = self.r
        L = [f"// objects.py seed {self.seed}", HEAD]
        L.append("function grown(n: number): any { const o: any = {}; for (let i = 0; i < n; i++) o[\"k\" + i] = i; return o; }")
        L.append("function shrunk(n: number): any { const o = grown(n); for (let i = 0; i < n; i += 2) delete o[\"k\" + i]; return o; }")
        L.append("function withAccessors(): any { let hidden = 1; return { get a() { return hidden; }, set a(v: number) { hidden = v * 2; }, get only() { return \"getter only\"; }, b: 2 }; }")
        L.append("function withHidden(): any { const o: any = { a: 1 }; Object.defineProperty(o, \"hidden\", { value: 2, enumerable: false, writable: true, configurable: true }); Object.defineProperty(o, \"ro\", { value: 3, enumerable: true, writable: false, configurable: false }); o.z = 4; return o; }")
        n = r.randint(6, 16)
        for i in range(n): L += self.function(i)
        L.append(f"for (let k = 0; k < {r.choice([2, 3])}; k++) {{")
        for i in range(n): L.append(f"  lines.push(\"f{i}\"); f{i}(k);")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
