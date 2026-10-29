#!/usr/bin/env python3
"""lazy-constants.py <seed>: random strict TypeScript programs about top-level constants whose initializers only make something (made at their first read):
each constant is read for the first time at one random place, in the middle of a computation that has many doubles, integers, strings and objects alive: in loops, leaf functions, closures,
methods, getters, callbacks of built-ins, async functions, generators, under try | finally, in default parameters; initializers that read other such constants, chains and diamonds of them."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function num(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
interface Rec { v: number; w: number; name: string; list: number[] }
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } norm(): number { return this.x * this.x + this.y * this.y; } }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.consts = []  # (name, kind)

    def initializer(self, i):
        r = self.r
        earlier = [c for c in self.consts]
        kind = r.choice(["rec", "rec", "list", "doubles", "map", "set", "fn", "point", "nested", "regexp", "strings", "recs", "mapnum"])
        dep = r.choice(earlier) if earlier and r.random() < 0.35 else None
        depv = {"rec": "{d}.v", "list": "{d}.length", "doubles": "{d}[0]", "map": "{d}.size", "set": "{d}.size", "fn": "7", "point": "{d}.x", "nested": "{d}.inner.deep.v", "regexp": "{d}.lastIndex", "strings": "{d}.length", "recs": "{d}[0].w", "mapnum": "{d}.size"}
        n = f"{r.randint(1, 9)}" if not dep else depv[dep[1]].format(d=dep[0])
        f = f"{r.randint(1, 9)}.{r.choice([25, 5, 75, 125])}"
        if kind == "rec": return kind, "Rec", f'{{ v: {n}, w: {f}, name: "k{i}", list: [{n}, {f}] }}'
        if kind == "list": return kind, "number[]", f"[{n}, {r.randint(1, 9)}, {r.randint(1, 9)}]"
        if kind == "doubles": return kind, "number[]", f"[{f}, {f}, {n}]"
        if kind == "map": return kind, "Map<string, number>", r.choice(["new Map()", f'new Map([["a", {n}], ["b", {f}]])'])
        if kind == "mapnum": return kind, "Map<number, Rec>", "new Map()"
        if kind == "set": return kind, "Set<number>", r.choice(["new Set()", f"new Set([{n}, {f}])"])
        if kind == "fn": return kind, "(x: number) => number", r.choice([f"x => x * {f}", f"x => x + {n}", "x => -x"])
        if kind == "point": return kind, "Point", f"new Point({n}, {f})"
        if kind == "nested": return kind, "{ inner: { deep: { v: number } }; list: number[] }", f"{{ inner: {{ deep: {{ v: {n} }} }}, list: [{f}] }}"
        if kind == "regexp": return kind, "RegExp", r.choice(["/a+b/", "/[0-9]+/g", "/x(y)?z/i"])
        if kind == "strings": return kind, "string[]", f'["s{i}", "t", "u" + "v"]'
        if kind == "recs": return kind, "Rec[]", f'[{{ v: {n}, w: {f}, name: "r{i}", list: [] }}, {{ v: 2, w: {f}, name: "q", list: [{f}] }}]'

    def read(self, c):
        """A number-valued expression that reads the constant."""
        name, kind = c
        r = self.r
        return {
            "rec": r.choice([f"{name}.v", f"{name}.w", f"{name}.list[1]", f"{name}.name.length"]),
            "list": r.choice([f"{name}[1]", f"{name}.length", f"{name}[0]"]),
            "doubles": r.choice([f"{name}[0]", f"{name}[1]"]),
            "map": r.choice([f"{name}.size", f'({name}.get("a") ?? 3)', f'({name}.has("b") ? 1 : 2)']),
            "mapnum": f"{name}.size",
            "set": r.choice([f"{name}.size", f"({name}.has(1) ? 5 : 6)"]),
            "fn": f"{name}(2)",
            "point": r.choice([f"{name}.x", f"{name}.y", f"{name}.norm()"]),
            "nested": r.choice([f"{name}.inner.deep.v", f"{name}.list[0]"]),
            "regexp": r.choice([f'({name}.test("xaab12xz") ? 1 : 0)', f"{name}.source.length"]),
            "strings": r.choice([f"{name}.length", f"{name}[0].length", f"{name}[2].length"]),
            "recs": r.choice([f"{name}[0].w", f"{name}[1].list.length", f"{name}.length"]),
        }[kind]

    def body(self, c, k):
        """A function (text) that first reads c somewhere in the middle, and the call expression (a string-valued expression)."""
        r = self.r
        rd = self.read(c)
        nd = r.randint(4, 14)
        ds = [f"d{j}" for j in range(nd)]
        init = "; ".join(f"let {d} = a * {j + 1}.5 + b / {j + 2}" for j, d in enumerate(ds))
        step = " ".join(f"{d} = {d} * 0.75 + {ds[(j + 1) % nd]} * 0.125 + i;" for j, d in enumerate(ds))
        ints = "let n0 = (a | 0) + 1, n1 = (b | 0) + 2, n2 = 3, n3 = 4;"
        istep = "n0 = (n0 * 31 + n1) | 0; n1 = (n1 + n2 + i) | 0; n2 = (n2 ^ n0) | 0; n3 = (n3 + 7) | 0;"
        total = " + ".join(ds) + " + n0 + n1 + n2 + n3"
        at = r.randint(0, 5)
        style = r.choice(["loop", "loop", "straight", "leaf", "closure", "method", "callback", "async", "generator", "try", "default", "getter", "sort", "nestedcall", "ternary"])
        f = f"f{k}"
        if style == "loop":
            return f"function {f}(a: number, b: number): number {{ {init}; {ints} let s = \"x\" + a; const o = new Point(a, b); for (let i = 0; i < 8; i++) {{ {step} {istep} if (i === {at}) d0 += {rd}; }} return {total} + s.length + o.norm(); }}", f"num({f}(k + 0.5, 2.25))"
        if style == "straight":
            return f"function {f}(a: number, b: number, p: Point): number {{ const i = 1; {init}; {ints} {step} const t = p.x * d0 + {rd} * d1 + p.y * d2; {step} {istep} return t + {total}; }}", f"num({f}(k + 0.5, 2.25, new Point(k, 1.5)))"
        if style == "leaf":
            return f"function {f}(a: number, b: number): number {{ return a * 1.5 + b * 2.5 + {rd} + a / b; }}", f"num({f}(k + 0.5, 2.25))"
        if style == "closure":
            return f"function {f}(a: number, b: number): () => number {{ {init}; return () => {{ const i = 2; {ints} {step} {istep} d1 += {rd}; return {total}; }}; }}", f"num({f}(k + 0.5, 2.25)())"
        if style == "method":
            return f"class C{k} {{ a = 1.5; b = 2.5; run(a: number, b: number): number {{ {init}; {ints} for (let i = 0; i < 4; i++) {{ {step} {istep} this.a += i === {at % 4} ? {rd} : d0; }} return this.a + this.b + {total}; }} }}", f"num(new C{k}().run(k + 0.5, 2.25))"
        if style == "callback":
            return f"function {f}(a: number, b: number): number {{ {init}; {ints} return [1.5, 2.5, 3.5].map((x, i) => {{ {step} {istep} return x * d0 + (i === {at % 3} ? {rd} : 0); }}).reduce((p, q) => p + q, 0) + {total}; }}", f"num({f}(k + 0.5, 2.25))"
        if style == "async":
            return f"async function {f}(a: number, b: number): Promise<number> {{ {init}; {ints} for (let i = 0; i < 4; i++) {{ {step} {istep} if (i === 1) await null; if (i === {at % 4}) d2 += {rd}; }} return {total}; }}", f"num(await {f}(k + 0.5, 2.25))"
        if style == "generator":
            return f"function* {f}(a: number, b: number): Generator<number, number, unknown> {{ {init}; {ints} for (let i = 0; i < 4; i++) {{ {step} {istep} if (i === {at % 4}) d2 += {rd}; yield d2; }} return {total}; }}", f"[...{f}(k + 0.5, 2.25)].map(num).join()"
        if style == "try":
            return f"function {f}(a: number, b: number): number {{ {init}; {ints} const i = 3; try {{ {step} d3 += {rd}; if (a < -5) throw new Error(\"no\"); }} catch (e) {{ d0 = -1; }} finally {{ {istep} d1 += 0.5; }} return {total}; }}", f"num({f}(k + 0.5, 2.25))"
        if style == "default":
            return f"function {f}(a: number, b: number, c = a * 1.25 + {rd} + b): number {{ const i = 1; {init}; {ints} {step} {istep} return c + {total}; }}", f"num({f}(k + 0.5, 2.25))"
        if style == "getter":
            return f"class C{k} {{ a: number; constructor(a: number) {{ this.a = a; }} get value(): number {{ const a = this.a, b = 2.25, i = 1; {init}; {ints} {step} {istep} return {rd} * d0 + {total}; }} }}", f"num(new C{k}(k + 0.5).value)"
        if style == "sort" and c[1] == "regexp":
            rd = f"{c[0]}.source.length"
        if style == "sort":
            return f"function {f}(a: number, b: number): string {{ let extra = a * 0.5; return [3.5, 1.5, 2.5, 0.5].sort((x, y) => {{ extra = a * 0.5 + {rd}; return x - y; }}).join() + num(extra + b); }}", f"{f}(k + 0.5, 2.25)"
        if style == "nestedcall":
            return f"function h{k}(x: number, y: number, z: number, w: number): number {{ return x * 2 + y * 3 + z * 5 + w * 7; }}\nfunction {f}(a: number, b: number): number {{ return h{k}(a * 1.5, b * 2.5 + a, {rd}, a / b) + h{k}({rd}, a, b, a + b); }}", f"num({f}(k + 0.5, 2.25))"
        return f"function {f}(a: number, b: number): number {{ const i = 1; {init}; {ints} {step} {istep} return (a > 100 ? d0 : d1 * {rd}) + {total}; }}", f"num({f}(k + 0.5, 2.25))"

    def program(self):
        r = self.r
        L = [f"// lazy-constants.py seed {self.seed}", HEAD]
        n = r.randint(12, 40)
        decls = []
        for i in range(n):
            kind, ty, init = self.initializer(i)
            self.consts.append((f"K{i}", kind))
            decls.append(f"const K{i}: {ty} = {init};")
        L += decls
        order = list(range(n))
        r.shuffle(order)
        calls = []
        for k, i in enumerate(order):
            text, call = self.body(self.consts[i], k)
            L.append(text)
            calls.append(call)
        L.append("async function main(): Promise<void> {")
        L.append(f"  for (let k = 0; k < 3; k++) {{")
        for k, call in enumerate(calls):
            L.append(f"    lines.push(\"{k} \" + {call});")
            if r.random() < 0.1: L.append("    collect();")
        L.append("  }")
        L.append("  lines.push([" + ", ".join(f"typeof K{i}" for i in range(n)) + "].join());")
        L.append('  console.log(lines.join("\\n"));')
        L.append("}")
        L.append('main().catch(e => { console.log(lines.join("\\n")); console.log("main failed " + String(e)); });')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
