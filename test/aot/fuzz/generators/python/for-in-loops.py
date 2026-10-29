#!/usr/bin/env python3
"""for-in-loops.py <seed>: random strict TypeScript programs about for-in loops and what their bodies do with the key: o[key] read once, twice, late, in a branch, in nested loops of every kind (written there or inlined from a
callee), behind hasOwn | in | hasOwnProperty guards, stored back, deleted, with keys added or removed while the loop runs, with the object replaced, with inherited and shadowed and hidden keys, index keys, over records, dictionaries, untyped objects,
instances, arrays, strings, null; nested for-in loops over the same and other objects; left by break | continue | labels | return | throw; values alive after the loop. RUN IT BOTH WITH AND WITHOUT VALIDATION: a user's build does not validate."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function q(x: any): string {
  if (x === undefined) return "undef"; if (x === null) return "null"; if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x); if (typeof x === "string") return "'" + x + "'"; if (typeof x === "function") return "fn";
  if (Array.isArray(x)) return "[" + x.map(q).join() + "]"; if (typeof x === "object") return "{" + Object.keys(x).map(k => k + ":" + q(x[k])).join() + "}"; return String(x);
}
function attempt(f: () => unknown): string { try { return q(f()); } catch (e) { return "threw " + (e as Error).constructor.name; } }
interface Rec { a: number; b: number; c?: number }
class Base { inherited = 1; method(): number { return 1; } }
class Heir extends Base { own = 2; other = "o"; }
function repeat(n: number, f: (i: number) => void): void { for (let i = 0; i < n; i++) f(i); }
function sumThrice(v: number): number { let s = 0; for (let i = 0; i < 3; i++) s += v; return s; }
function joinTwice(v: unknown): string { let s = ""; let i = 0; while (i < 2) { s += q(v); i++; } return s; }
function callEach(f: unknown, n: number): string { let s = ""; for (let i = 0; i < n; i++) s += typeof f === "function" ? q(f(i)) : q(f); return s; }
'''

OBJECTS = [
    ("Record<string, number>", ["{ a: 5, b: 6 }", "{ a: 1, b: 2.5, c: -0 }", "{}", "{ only: k }", "{ a: k, b: k + 1, c: k + 2, d: k + 3, e: k + 4 }", "{ 1: 10, 0: 20, x: 30 }", "Object.fromEntries([[\"p\", 1], [\"q\", 2]])", "JSON.parse('{\"j\":1,\"k\":2}')"]),
    ("Record<string, string>", ["{ a: \"x\", b: \"yz\" }", "{ e: \"\" }"]),
    ("Rec", ["{ a: 1, b: 2 }", "{ a: 1, b: 2, c: 3 }", "{ a: k, b: 0.5, c: undefined }"]),
    ("any", ["{ a: 1, b: \"two\", c: null, d: undefined, e: [3], f: { g: 4 } }", "[1, 2, 3]", "[1, , 3]", "\"ab\"", "new Heir()", "Object.create({ far: 1 }, { near: { value: 2, enumerable: true }, hidden: { value: 3, enumerable: false } })", "Object.assign(Object.create({ a: \"shadowed\", z: \"far\" }), { a: \"near\" })",
             "null", "undefined", "5", "{ f() { return 1; }, g: (i: number) => i * 2, h: 3 }", "Object.freeze({ a: 1, b: 2 })", "(() => { const o: any = {}; for (let i = 0; i < 70; i++) o[\"k\" + i] = i; return o; })()", "(() => { const o: any = { a: 1, b: 2, c: 3 }; delete o.b; return o; })()",
             "new Proxy({ a: 1, b: 2 }, {})", "{ get a() { return k; }, b: 2 }", "Object.assign([7, 8], { extra: 9 })", "new Map([[1, 2]])", "(function (..._: unknown[]) { return arguments; })(4, 5)"]),
]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0
        self.is_rec = {}

    def fresh(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def use(self, v):
        r = self.r
        return r.choice([f"out += q({v});", f"out += q({v}) + \",\";", f"count++; out += typeof {v};", f"out += joinTwice({v});", f"last = {v};", f"out += callEach({v}, 2);", f"if ({v}) out += \"T\"; else out += \"F\";", f"out += typeof {v} === \"function\" ? \"F\" : String({v}).length;"])

    def inner_loop(self, body, o=None, key=None):
        r = self.r
        i = self.fresh("i")
        n = r.choice(["0", "1", "2", "3", "k", "k + 1"])
        c = r.random()
        if o and r.random() < 0.35:
            # The three other ways into a loop: a branch that is decided ahead of it; the key's own use as the loop's condition; something harmless and not constant made ahead of the loop and used only in it.
            g = self.fresh("g")
            way = r.random()
            if way < 0.34:
                return [f"let {g} = true, {i} = 0; while ({g}) {{ {i}++; if ({i} > {r.randint(0, 2)}) {{"] + body + [f"}} if ({i} >= {r.randint(1, 3)}) {g} = false; }}"]
            if way < 0.67:
                test = r.choice([f"{o}[{key}] !== undefined", f"{key} in Object({o})", f"Object.hasOwn(Object({o}), {key})", f"{o}[{key}] != null", f"typeof {o}[{key}] !== \"symbol\""])
                order = r.choice([f"{test} && {g}++ < {r.randint(1, 3)}", f"{g}++ < {r.randint(1, 3)} && {test}"])
                return [f"let {g} = 0; while ({order}) {{"] + body + ["}"]
            h = self.fresh("h")
            made = r.choice([f"typeof last", f"Object.hasOwn(Object({o}), {key})", f"!({key} in Object({o}))", f"typeof {o}[{key}]", f"{key} === \"a\"", f"count > 1"])
            return [f"const {h} = {made}; for (let {i} = 0; {i} < {n}; {i}++) {{ out += String({h});"] + body + ["}"]
        if c < 0.30: return [f"for (let {i} = 0; {i} < {n}; {i}++) {{"] + body + ["}"]
        if c < 0.50: return [f"let {i} = 0; while ({i} < {n}) {{"] + body + [f"{i}++; }}"]
        if c < 0.62: return [f"let {i} = 0; do {{"] + body + [f"{i}++; }} while ({i} < {n});"]
        if c < 0.72: return [f"for (const {i} of [1, 2]) {{"] + body + ["}"]
        if c < 0.82: return [f"repeat({n}, () => {{"] + body + ["});"]
        if c < 0.90: return [f"for (let {i} = 0; {i} < 5; {i}++) {{ if ({i} === {r.randint(0, 3)}) {r.choice(['break', 'continue'])};"] + body + ["}"]
        return [f"for (let {i} = 3; {i} > 0; {i}--) {{"] + body + ["}"]

    def body(self, o, name, depth, others):
        r = self.r
        L = []
        key = f"({name} as keyof Rec)" if self.is_rec.get(o) else name
        v = self.fresh("v")
        c = r.random()
        guard = r.choice(["", "", "", f"if (Object.hasOwn(Object({o}), {key})) ", f"if ({key} in Object({o})) ", f"if (Object.prototype.hasOwnProperty.call({o}, {key})) ", f"if (!Object.hasOwn(Object({o}), {key})) continue; "])
        inner = []
        inner.append(f"const {v} = {o}[{key}];")
        for _ in range(r.randint(1, 4)):
            c = r.random()
            if c < 0.30: inner += self.inner_loop([self.use(r.choice([v, v, f"{o}[{key}]"])) for _ in range(r.randint(1, 2))], o, key)
            elif c < 0.45: inner.append(self.use(r.choice([v, f"{o}[{key}]", name])))
            elif c < 0.52 and depth > 0:
                o2 = r.choice(others + [o])
                k2 = self.fresh("key")
                inner += [f"for (const {k2} in {o2}) {{"] + self.body(o2, k2, depth - 1, others) + [self.use(v), "}"]
            elif c < 0.58: inner.append(f"attempt(() => {{ ({o} as any)[{key}] = {v}; }});")
            elif c < 0.63: inner.append(f"attempt(() => {{ delete ({o} as any).{r.choice(['a', 'b', 'c', 'near', 'k3'])}; }});")
            elif c < 0.67: inner.append(f"if (count < 6) attempt(() => {{ ({o} as any)[\"added\" + count] = {v}; }});")
            elif c < 0.72: inner.append(f"if (typeof {v} === \"number\") out += sumThrice({v});")
            elif c < 0.76: inner.append(r.choice(["if (count > 4) break;", "if (count % 2) continue;", "if (count > 6) return out + \"|left\";", "if (count > 8) throw new Error(\"out\");"]))
            elif c < 0.80: inner.append("collect();")
            elif c < 0.86: inner += [f"if ({r.choice(['k', 'count % 2', 'out.length > 10'])}) {{"] + self.inner_loop([self.use(v)], o, key) + ["} else {", self.use(v), "}"]
            elif c < 0.90: inner += ["try {"] + self.inner_loop([self.use(v)]) + ["} catch { out += \"caught\"; } finally { count++; }"]
            else: inner.append("count++;")
        if guard.endswith("continue; "): L.append(guard); L += inner
        elif guard: L += [guard + "{"] + inner + ["}"]
        else: L += inner
        return L

    def function(self, i):
        r = self.r
        decls, names = [], []
        for j in range(r.randint(1, 2)):
            t, makers = r.choice(OBJECTS)
            n = f"o{j}"
            decls.append(f"  const {n}: {t} = {r.choice(makers)};")
            names.append(n)
            self.is_rec[n] = t == "Rec"
        key = self.fresh("key")
        L = [f"function f{i}(k: number): string {{", "  let out = \"\", count = 0; let last: unknown = \"none\";"] + decls
        L.append(f"  {r.choice(['', '', 'outer: '])}for ({r.choice(['const', 'const', 'let', 'var'])} {key} in {names[0]}) {{")
        L += ["    " + s for s in self.body(names[0], key, 1, names)]
        L.append("  }")
        L.append("  return out + \"|\" + count + \"|\" + q(last) + \"|\" + " + " + ".join(f"attempt(() => q({n}))" for n in names) + ";")
        L.append("}")
        return L

    def top_level(self, i):
        r = self.r
        t, makers = r.choice(OBJECTS[:3])
        key, v = self.fresh("key"), self.fresh("v")
        o = f"top{i}"
        acc = f"acc{i}"
        return [f"const {o}: {t} = {r.choice(makers).replace('k', '2')};", f"let {acc} = \"\";", f"for (const {key} in {o}) {{ const {v} = {o}[{key} as keyof typeof {o}];"] + self.inner_loop([f"{acc} += q({v});"]) + ["}", f"lines.push(\"top{i} \" + {acc});"]

    def program(self):
        r = self.r
        L = [f"// for-in-loops.py seed {self.seed}", HEAD, "const k = 2;" if False else ""]
        n = r.randint(5, 14)
        for i in range(n): L += self.function(i)
        for i in range(r.randint(0, 3)):
            L += [s.replace("< k + 1", "< 3").replace("< k;", "< 2;").replace("< k)", "< 2)").replace("repeat(k", "repeat(2") for s in self.top_level(i)]
        L.append(f"for (let k = 0; k < {r.choice([2, 3])}; k++) {{")
        for i in range(n): L.append(f"  lines.push(\"f{i} \" + attempt(() => f{i}(k)));")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
