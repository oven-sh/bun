#!/usr/bin/env python3
"""tail-calls.py <seed>: random strict TypeScript programs about calls in tail position: a web of functions with 0 to 13 parameters of mixed kinds (doubles, integers, strings,
records, closures, arrays, booleans, optional numbers) that tail call each other and themselves with their arguments permuted, with locals, with records | closures | arrays made in the frame, directly, through
?: && || ?? the comma, `as` and `!`, through tables of functions, methods, call and apply; result types that need work behind the call; calls that are not in tail position in between; try | finally around some;
run 0, 1, 2, 7, 60 and 30,000 deep; the bottom prints every argument, and sometimes the frames that are left."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const young: () => void = typeof G.edenGC === "function" ? G.edenGC : () => G.Bun.gc(false);
const lines: string[] = [];
interface Rec { v: number; s: string }
function num(x: number | undefined): string { return x === undefined ? "undef" : Object.is(x, -0) ? "-0" : String(x); }
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "thrown " + String(e); } }
function frames(): string {
  const names: string[] = [];
  for (const line of String(new Error().stack).split("\n")) { const m = /^\s*at (?:async )?(?:[\w$]+\.)?(t\d+|m\d+)\b|^(t\d+|m\d+)@/.exec(line); if (m) names.push(m[1] ?? m[2]); }
  return names.slice(0, 8).join("<");
}
let bottoms = 0;
'''
KINDS = ["num", "num", "int", "str", "rec", "fn", "arr", "bool", "opt"]
TS = {"num": "number", "int": "number", "str": "string", "rec": "Rec", "fn": "() => number", "arr": "number[]", "bool": "boolean", "opt": "number | undefined"}
RESULTS = ["string", "string", "string", "number", "unknown", "string | number", "number | undefined"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.fns = []  # (name, [kinds], result, is_method)
        self.n = 0

    def fresh(self, p="x"):
        self.n += 1
        return f"{p}{self.n}"

    def value(self, kind, env):
        """An expression of the kind: something in scope, or something made here."""
        r = self.r
        have = [n for n, k in env if k == kind or (kind == "num" and k == "int") or (kind == "opt" and k in ("num", "int"))]
        if have and r.random() < 0.7: return r.choice(have)
        nums = [n for n, k in env if k in ("num", "int")] or ["d"]
        a = r.choice(nums)
        if kind == "num": return r.choice([f"{a} + 0.5", f"{a} * 1.5", "0.25", "-0", "1e300", f"{a} / 3", "NaN", f"d + 0.125"])
        if kind == "int": return r.choice([f"({a} | 0)", "7", "d", "d + 1", "-1", "2147483647", f"(({a} * 3) | 0)"])
        if kind == "str": return r.choice(['"s"', '""', f'"n" + d', f'"long " + {a}', "String(d)"])
        if kind == "rec": return r.choice([f'{{ v: {a}, s: "r" }}', f'{{ v: d, s: "d" + d }}', "shared"])
        if kind == "fn": return r.choice([f"() => {a}", f"() => d * 2", "seven", f"() => {a} + d"])
        if kind == "arr": return r.choice([f"[{a}, d]", "[]", "[1.5, 2.5]", f"[d, d, d]"])
        if kind == "bool": return r.choice(["true", "false", "d % 2 === 0", f"{a} > 1"])
        return r.choice(["undefined", f"{a}", "d"])

    def describe(self, name, kind):
        return {"num": f"num({name})", "int": f"num({name})", "str": name, "rec": f"{name}.v + {name}.s", "fn": f"num({name}())", "arr": f'"[" + {name}.join() + "]"', "bool": f"String({name})", "opt": f"num({name})"}[kind]

    def call(self, callee, env, depth="d - 1"):
        name, kinds, result, is_method = callee
        args = ", ".join([depth] + [self.value(k, env) for k in kinds])
        r = self.r
        if is_method:
            return f"host.{name}({args})"
        c = r.random()
        if c < 0.70: return f"{name}({args})"
        if c < 0.80: return f"{name}.call(undefined, {args})"
        if c < 0.86: return f"{name}.apply(undefined, [{args}])"
        if c < 0.93: return f"(d % 2 ? {name} : {name})({args})"
        return f"table{name}[d % 2]({args})"

    def fits(self, callee_result, result):
        if result == "unknown": return True
        if callee_result == result: return True
        if result == "string | number": return callee_result in ("string", "number")
        if result == "number | undefined": return callee_result == "number"
        return False

    def tail(self, me, env):
        r = self.r
        result = me[2]
        able = [f for f in self.fns if self.fits(f[2], result)]
        a, b = r.choice(able), r.choice(able)
        if r.random() < 0.25: a = me
        ca, cb = self.call(a, env), self.call(b, env)
        c = r.random()
        cond = r.choice(["d % 2 === 0", "d % 3 === 1", "d > 5", "d === 1"] + [n for n, k in env if k == "bool"])
        if c < 0.45: return ca
        if c < 0.65: return f"{cond} ? {ca} : {cb}"
        if c < 0.70: return f"(bottoms++, {ca})"
        if c < 0.75 and result == "unknown": return f"{cond} && {ca}"
        if c < 0.80 and result == "unknown": return f"{cond} || {ca}"
        if c < 0.85 and a[2] == "number | undefined" and self.fits(b[2], result): return f"{self.call(a, env, '0')} ?? {cb}"
        if c < 0.90: return f"({ca})"
        if c < 0.94 and a[2] == result: return f"{ca} as {result}"
        if c < 0.97 and a[2] in ("string", "number"): return f"{ca}!"
        return f"{cond} ? ({cond} ? {ca} : {cb}) : {cb}"

    def bottom(self, me, env):
        name, kinds, result, _ = me
        text = ' + "," + '.join([f'"{name}"'] + [self.describe(n, k) for n, k in env if n != "d"])
        if result in ("string", "unknown", "string | number"):
            return ('{ bottoms++; return ' + str(text) + str(' + "|" + frames()' if self.r.random() < 0.3 else '') + '; }')
        nums = [n for n, k in env if k in ("num", "int") and n != "d"]
        lines = f"if (bottoms < 150) lines.push({text});"
        return f"{{ bottoms++; {lines} return {' + '.join(nums) if nums else '0.5'}; }}"

    def function(self, me):
        r = self.r
        name, kinds, result, is_method = me
        params = [("d", "int")] + [(f"p{i}", k) for i, k in enumerate(kinds)]
        env = list(params)
        sig = ", ".join(f"{n}: {TS[k]}" for n, k in params)
        L = [f"{'' if is_method else 'function '}{name}({sig}): {result} {{", f"  if (d <= 0) {self.bottom(me, env)}"]
        for _ in range(r.randint(0, 4)):
            c = r.random()
            if c < 0.55:
                k = r.choice(KINDS)
                v = self.fresh()
                L.append(f"  const {v}: {TS[k]} = {self.value(k, env)};")
                env.append((v, k))
            elif c < 0.70:
                callee = r.choice(self.fns)
                v = self.fresh("r")
                L.append(f"  const {v} = String({self.call(callee, env, '0')});")
                env.append((v, "str"))
            elif c < 0.78:
                L.append(f"  if (d % 977 === 0) {r.choice(['young();', 'collect();'])}")
            elif c < 0.86:
                callee = r.choice([f for f in self.fns if self.fits(f[2], result)])
                L.append(f"  if (d === {r.randint(1, 4)}) {{ try {{ return {self.call(callee, env)}; }} finally {{ bottoms++; }} }}")
            elif c < 0.93:
                recs = [n for n, k in env if k == "rec"]
                if recs: L.append(f"  if (d < 3 && {recs[0]} !== shared) {recs[0]}.v += 1;")
            else:
                arrs = [n for n, k in env if k == "arr"]
                if arrs: L.append(f"  if (d < 3) {arrs[0]}.push(d);")
        if r.random() < 0.3:
            L.append(f"  if (d % 5 === 2) return {self.tail(me, env)};")
        L.append(f"  return {self.tail(me, env)};")
        L.append("}")
        return L

    def program(self):
        r = self.r
        L = [f"// tail-calls.py seed {self.seed}", HEAD, 'const shared: Rec = { v: 42, s: "shared" };', "function seven(): number { return 7; }"]
        n = r.randint(5, 12)
        for i in range(n):
            kinds = [r.choice(KINDS) for _ in range(r.choice([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13]))]
            is_method = r.random() < 0.15
            self.fns.append((f"{'m' if is_method else 't'}{i}", kinds, "string" if i == 0 else r.choice(RESULTS), is_method))
        methods = [f for f in self.fns if f[3]]
        for f in self.fns:
            if not f[3]: L += self.function(f)
        L.append("class Host {")
        for f in methods: L += ["  " + s for s in self.function(f)]
        L.append("}")
        L.append("const host = new Host();")
        for f in self.fns:
            if not f[3]: L.append(f"const table{f[0]} = [{f[0]}, {f[0]}];")
        L.append("const d = 3;")
        for f in self.fns:
            for depth in ("0", "1", "2", "7", "60", "30000"):
                L.append(f"lines.push(\"{f[0]} {depth} \" + attempt(() => {self.call(f, [('d', 'int')], depth)}));")
        L.append('lines.push("bottoms " + bottoms);')
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
