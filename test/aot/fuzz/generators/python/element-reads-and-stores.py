#!/usr/bin/env python3
"""element-reads-and-stores.py <seed>: random strict TypeScript programs about element reads and stores: arrays of integers, doubles, objects, strings and mixtures, with holes made by
length, delete, stores past the end and new Array(n); sparse arrays; frozen and sealed arrays; heirs of Array; typed arrays; strings; keys that are integers, negative, fractions, NaN, -0, huge, numeric strings;
loops up and down with the length read once or every turn, while the body pushes, pops, shifts, splices, truncates or converts the array. What is read is used in arithmetic, in comparisons, as text and by itself."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function num(x: number | undefined | null): string { return x === undefined ? "undef" : x === null ? "null" : Object.is(x, -0) ? "-0" : String(x); }
function any(x: unknown): string { return typeof x === "number" ? num(x) : typeof x === "object" && x !== null ? "obj" + JSON.stringify(x) : typeof x + ":" + String(x); }
function show(a: ArrayLike<unknown>): string { let s = a.length + "["; for (let i = 0; i < a.length && i < 24; i++) s += (i in a ? any(a[i]) : "hole") + ","; return s + "]"; }
function attempt(f: () => string): string { try { return f(); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "thrown " + String(e); } }
interface Rec { v: number; s: string }
class Mine extends Array<number> { sum(): number { let s = 0; for (let i = 0; i < this.length; i++) s += this[i]; return s; } }
'''
KEYS = ["0", "1", "2", "3", "5", "7", "-1", "-2", "0.5", "1.5", "NaN", "-0", "4294967294", "4294967295", "4294967296", "2147483647", "2147483648", "-2147483648", "1e21", "Infinity", "k", "k + 1", "k - 1", "k * 2", "a.length", "a.length - 1", "a.length + 1", "(a.length >> 1)", "k / 2", "-k"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    def maker(self):
        """(element kind, type text, expression that makes a fresh array)"""
        r = self.r
        c = r.random()
        if c < 0.16: return "num", "number[]", r.choice(["[1, 2, 3, 4, 5]", "[10, 20, 30]", "[0]", "[]", "[7, 7, 7, 7, 7, 7, 7, 7, 7]", "[2147483647, -2147483648, 0]"])
        if c < 0.32: return "num", "number[]", r.choice(["[0.5, 1.5, 2.5, 3.5]", "[1.25]", "[NaN, 1.5, -0]", "[1e300, -1e300, 0.1]", "[1, 2.5, 3]", "[Infinity, -Infinity, 0.5]"])
        if c < 0.42: return "num", "number[]", r.choice(["holey([1, 2, 3, 4, 5], 1)", "holey([0.5, 1.5, 2.5, 3.5], 2)", "longer([1, 2], 5)", "longer([0.5], 4)", "past([1.5, 2.5], 4)", "past([1, 2], 3)", "new Array<number>(4)", "filled(6)", "sparse()"])
        if c < 0.50: return "rec", "Rec[]", r.choice(['[{ v: 1, s: "a" }, { v: 2, s: "b" }, { v: 3, s: "c" }]', "[]", '[{ v: 0.5, s: "" }]'])
        if c < 0.57: return "str", "string[]", r.choice(['["a", "b", "c"]', '["", "xy"]', "[]", '"p,q,r,s".split(",")'])
        if c < 0.64: return "mix", "(number | string | null)[]", r.choice(['[1, "a", null, 2.5]', "[null, null]", '["x", 1]', "[1, 2, 3]"])
        if c < 0.70: return "num", "number[]", r.choice(["Object.freeze([1, 2, 3]) as number[]", "Object.seal([0.5, 1.5]) as number[]", "Object.preventExtensions([1, 2]) as number[]"])
        if c < 0.75: return "num", "Mine", r.choice(["Mine.from([1, 2, 3]) as Mine", "new Mine(3)", "Mine.of(0.5, 1.5) as Mine"])
        if c < 0.86: return "typed", r.choice(["Float64Array", "Int32Array", "Uint8Array", "Int8Array", "Uint32Array", "Float32Array", "Uint8ClampedArray", "Int16Array"]), None
        if c < 0.93: return "text", "string", r.choice(['"hello world"', '""', '"a"', '"h\\u00e9llo \\u4e16\\u754c"', '"ab" + "cd".repeat(3)', '"0123456789".slice(2, 7)'])
        return "num", "number[]", r.choice(["Array.from({ length: 5 }, (_, i) => i * 1.5)", "[1, 2, 3].map(x => x / 2)", "[3, 1, 2].slice()", "[1, 2, 3, 4].filter(x => x % 2 === 0)", "[...[1.5, 2.5], 3]", "[1, 2].concat([0.5])"])

    def read_use(self, kind, e):
        r = self.r
        if kind in ("num", "typed"):
            return r.choice([f"num({e})", f"num({e} + 1)", f"num({e} * 2)", f"num({e} - 0.5)", f"String({e} < 2)", f"String({e} >= 1)", f"String({e} === undefined)", f"num({e} ?? -7)", f"typeof {e}", f"num({e} | 0)", f"num(-{e})", f"String({e} === {e})",
                             f"num(Math.floor({e}))", f"`<${{{e}}}>`", f"num({e} + {e})", f"String(!{e})", f"num({e} / 2)", f"num({e} % 3)", f"num(Math.max({e}, 0))", f"String({e} == null)"])
        if kind == "rec":
            return r.choice([f"any({e})", f"attempt(() => num({e}.v))", f"num({e}?.v)", f"String({e} === undefined)", f"typeof {e}", f"attempt(() => {e}.s + \"!\")"])
        if kind == "str":
            return r.choice([f"any({e})", f"attempt(() => String({e}.length))", f"String({e} === undefined)", f"typeof {e}", f"{e} + \"|\"", f"String({e} < \"b\")"])
        if kind == "text":
            return r.choice([f"any({e})", f"typeof {e}", f"String({e} === undefined)", f"{e} + \"|\"", f"String({e} === \"l\")"])
        return r.choice([f"any({e})", f"typeof {e}", f"String({e} === null)", f"String({e} ?? \"dflt\")", f"String({e} == null)"])

    def value(self, kind):
        r = self.r
        if kind in ("num", "typed"): return r.choice(["1", "2.5", "k", "k + 0.5", "-0", "NaN", "300", "-1", "4294967296", "1e300"])
        if kind == "rec": return r.choice(['{ v: k, s: "n" }', '{ v: 0.25, s: "m" }'])
        if kind == "str": return r.choice(['"z"', '"n" + k', '""'])
        return r.choice(["1", '"s"', "null", "0.5"])

    def mutate(self, kind):
        r = self.r
        v = self.value(kind)
        if kind == "typed": return r.choice([f"a[{r.choice(KEYS)}] = {v};", f"a.fill({v}, 1, 2);", "a.reverse();", f"a.set([{v}], 0);"])
        if kind == "text": return "collect();"
        return r.choice([f"a.push({v});", "a.pop();", "a.shift();", f"a.unshift({v});", "a.length = 2;", "a.length = a.length + 2;", "a.length = 0;", f"a[{r.choice(KEYS)}] = {v};", "delete a[1];", "a.splice(1, 1);", f"a.splice(0, 0, {v});", "a.reverse();",
                         f"a[a.length] = {v};", f"a[a.length + 3] = {v};", "collect();", f"a.fill({v});", "a.copyWithin(0, 1);"])

    def function(self, k):
        r = self.r
        kind, ty, make = self.maker()
        if kind == "typed":
            make = f"new {ty}({r.choice(['[1, 2, 3, 4]', '5', '[]', '[250, 251, 252]', '[0.5, 1.5, -1.5]'])})"
        L = [f"function f{k}(k: number): void {{", f"  const a: {ty} = {make};"]
        for _ in range(r.randint(2, 7)):
            c = r.random()
            key = r.choice(KEYS)
            if c < 0.30:
                L.append(f"  lines.push({self.read_use(kind, f'a[{key}]')});")
            elif c < 0.42 and kind != "text":
                L.append(f"  lines.push(attempt(() => {{ {self.mutate(kind)} return show(a); }}));")
            elif c < 0.50:
                L.append(f"  lines.push({self.read_use(kind, f'(a as any)[String({key})]') if kind == 'mix' else 'any((a as any)[String(' + key + ')])'});")
            elif c < 0.56:
                L.append(f"  lines.push(String(({key}) in (a as any)) + String(Object.hasOwn(a, {key})));" if kind != "text" else f"  lines.push(any(a.at({key})) + any(a.charAt({key})) + num(a.charCodeAt({key})) + num(a.codePointAt({key})));")
            elif c < 0.62 and kind != "text":
                L.append(f"  lines.push(any(a.at({key})) + \" \" + a.indexOf({self.value(kind)} as never) + \" \" + a.includes({self.value(kind)} as never));")
            else:
                i = self.fresh("i")
                e = f"a[{r.choice([i, i, i, i + ' + 1', i + ' - 1', i + ' * 2', 'a.length - 1 - ' + i, i + ' + k'])}]"
                use = self.read_use(kind, e)
                change = ""
                if kind != "text" and r.random() < 0.45:
                    change = f" if ({i} === {r.randint(0, 3)}) attempt(() => {{ {self.mutate(kind)} return \"\"; }});"
                form = r.random()
                guard = self.fresh("g")
                if form < 0.3:
                    L.append(f"  {{ let s = \"\"; for (let {i} = 0, {guard} = 0; {i} < a.length && {guard}++ < 20; {i}++) {{ s += {use} + \",\";{change} }} lines.push(s); }}")
                elif form < 0.5:
                    L.append(f"  {{ let s = \"\"; const n = a.length; for (let {i} = 0; {i} < n; {i}++) {{ s += {use} + \",\";{change} }} lines.push(s); }}")
                elif form < 0.65:
                    L.append(f"  {{ let s = \"\"; for (let {i} = a.length - 1; {i} >= 0; {i}--) {{ s += {use} + \",\";{change} }} lines.push(s); }}")
                elif form < 0.78 and kind in ("num", "typed"):
                    L.append(f"  {{ let t = 0; for (let {i} = 0, {guard} = 0; {i} < a.length + {r.randint(0, 2)} && {guard}++ < 20; {i}++) {{ t += {e};{change} }} lines.push(num(t)); }}")
                elif form < 0.88 and kind in ("num", "typed"):
                    L.append(f"  {{ let t = 1, m = -Infinity; for (let {i} = 0, {guard} = 0; {i} < a.length && {guard}++ < 20; {i}++) {{ const x = {e}; t = t * 0.5 + x; if (x > m) m = x;{change} }} lines.push(num(t) + num(m)); }}")
                else:
                    L.append(f"  {{ let s = \"\", {guard} = 0; for (const x of a) {{ s += {self.read_use(kind, 'x')} + \",\"; if ({guard}++ > 20) break;{change.replace(i + ' ===', guard + ' ===')} }} lines.push(s); }}")
        L.append("  lines.push(show(a));")
        L.append("}")
        return L

    def program(self):
        r = self.r
        L = [f"// element-reads-and-stores.py seed {self.seed}", HEAD]
        L.append("function holey(a: number[], at: number): number[] { delete a[at]; return a; }")
        L.append("function longer(a: number[], n: number): number[] { a.length = n; return a; }")
        L.append("function past(a: number[], at: number): number[] { a[at] = 9.5; return a; }")
        L.append("function filled(n: number): number[] { const a = new Array<number>(n); for (let i = 0; i < n; i += 2) a[i] = i + 0.5; return a; }")
        L.append("function sparse(): number[] { const a: number[] = [1, 2]; a[100000] = 3; return a; }")
        n = r.randint(6, 14)
        for k in range(n):
            L += self.function(k)
        L.append(f"for (let k = 0; k < {r.choice([2, 3, 5])}; k++) {{")
        for k in range(n):
            L.append(f"  lines.push(\"f{k}\"); lines.push(attempt(() => {{ f{k}(k); return \"ok\"; }}));")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
