#!/usr/bin/env python3
"""async-code-order.py <seed>: random strict TypeScript programs about the ORDER in which asynchronous code runs and what it keeps alive: many async functions, arrows, methods and async generators started
together, each logging every step; awaits of plain values, settled and pending promises, thenables (with getters, that call back at once, late, twice, or throw), promises returned from async functions, `return await`; try | catch | finally
around awaits, rejections thrown into frames, loops with awaits, for await over async generators, arrays of promises and sync iterables; Promise.all | allSettled | race | any | then chains | queueMicrotask in between; many locals of every
kind (cells, strings, doubles, integers, booleans, closures) alive across each await, with collections at random steps."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const young: () => void = typeof G.edenGC === "function" ? G.edenGC : () => G.Bun.gc(false);
const log: string[] = [];
function say(s: string): void { log.push(s); }
function queueMicrotask(f: () => void): void { void Promise.resolve().then(f); }
interface Rec { v: number; s: string }
function num(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
let gates: (() => void)[] = [];
function gate(): Promise<void> { return new Promise<void>(open => { gates.push(open); }); }
function gateWith<T>(value: T): Promise<T> { return new Promise<T>(open => { gates.push(() => open(value)); }); }
function failingGate(why: string): Promise<never> { return new Promise<never>((_, fail) => { gates.push(() => fail(new Error(why))); }); }
function thenable(value: number, how: number): PromiseLike<number> {
  return { then(done: any, fail: any): any {
    say("then called " + value + "/" + how);
    if (how === 0) done(value);
    else if (how === 1) queueMicrotask(() => done(value));
    else if (how === 2) { done(value); done(value + 100); fail(new Error("late")); }
    else if (how === 3) fail(new Error("thenable " + value));
    else if (how === 4) throw new Error("thrown by then " + value);
    else gates.push(() => done(value));
  } } as PromiseLike<number>;
}
function text(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function churn(k: number): void { let sink: unknown[] = []; for (let i = 0; i < 40; i++) sink.push({ i, s: "g" + (i + k), l: [i] }); sink = []; }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.fns = []  # (name, kind) kind: 'async' returns Promise<number>
        self.n = 0

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    def awaited(self, me):
        """An expression to await that yields a number (or rejects)."""
        r = self.r
        c = r.random()
        earlier = [f for f in self.fns if f != me]
        if c < 0.10: return r.choice(["1", "k", "0.5", "k + 0.25"])
        if c < 0.20: return r.choice(["Promise.resolve(k)", "Promise.resolve(2.5)", "Promise.resolve(Promise.resolve(k + 1))"])
        if c < 0.32: return r.choice(["gateWith(k)", "gateWith(k * 2)", "gateWith(0.75)"])
        if c < 0.44: return f"thenable(k + {r.randint(0, 9)}, {r.randint(0, 5)})"
        if c < 0.50: return r.choice(['Promise.reject(new Error("rejected " + k))', 'failingGate("gate " + k)'])
        if c < 0.68 and earlier: return f"{r.choice(earlier)}(k + 1, depth - 1)"
        if c < 0.74: return "new Promise<number>(done => { queueMicrotask(() => done(k)); })"
        if c < 0.80: return "Promise.resolve(k).then(x => x + 1)"
        if c < 0.85: return "Promise.resolve(k).then(x => Promise.resolve(x * 2))"
        if c < 0.90 and len(earlier) >= 2:
            a, b = r.sample(earlier, 2)
            how = r.choice(["all", "race", "any", "allSettled"])
            if how == "all": return f"Promise.all([{a}(k, depth - 1), {b}(k + 1, depth - 1), 3]).then(xs => xs[0] + xs[1] + xs[2])"
            if how == "allSettled": return f"Promise.allSettled([{a}(k, depth - 1), {b}(k + 1, depth - 1)]).then(xs => xs.filter(x => x.status === \"fulfilled\").length)"
            return f"Promise.{how}([{a}(k, depth - 1), {b}(k + 1, depth - 1), gateWith(9)])"
        if c < 0.95: return "(async () => { await null; return k + 2; })()"
        return "(async () => k + 3)()"

    def locals(self):
        r = self.r
        decls, uses = [], []
        for _ in range(r.randint(0, 9)):
            v = self.fresh()
            kind = r.choice(["rec", "str", "dbl", "int", "bool", "fn", "arr", "map"])
            if kind == "rec": decls.append(f'const {v}: Rec = {{ v: k + {r.randint(0, 9)}, s: "r" + k }};'); uses.append(f"{v}.v + {v}.s")
            elif kind == "str": decls.append(f'const {v} = "s" + k + "{v}";'); uses.append(v)
            elif kind == "dbl": decls.append(f"let {v} = k * 1.5 + {r.randint(0, 9)}.25;"); uses.append(f"num({v})")
            elif kind == "int": decls.append(f"let {v} = (k * 7 + {r.randint(0, 99)}) | 0;"); uses.append(f"num({v})")
            elif kind == "bool": decls.append(f"const {v} = k % 2 === {r.randint(0, 1)};"); uses.append(f"String({v})")
            elif kind == "fn": decls.append(f"const {v} = () => k * {r.randint(2, 5)};"); uses.append(f"num({v}())")
            elif kind == "arr": decls.append(f"const {v} = [k, {r.randint(0, 9)}.5, k + 1];"); uses.append(f"{v}.join(\"_\")")
            else: decls.append(f'const {v} = new Map<string, number>([["a", k]]);'); uses.append(f'num({v}.get("a")!)')
        return decls, uses

    def body(self, me, depth, tag):
        r = self.r
        S = []
        for step in range(r.randint(1, 4)):
            c = r.random()
            label = f"{tag}.{step}"
            if c < 0.40:
                v = self.fresh("a")
                S.append(f"const {v} = await {self.awaited(me)}; total += {v}; say(name + \" {label} \" + num({v}));")
            elif c < 0.52 and depth > 0:
                S += ["try {"] + self.body(me, depth - 1, label + "t") + [f"}} catch (e) {{ say(name + \" {label} caught \" + text(e));"] + (self.body(me, 0, label + "c") if r.random() < 0.4 else []) + ["}" + (" finally {" if r.random() < 0.5 else "")]
                if S[-1].endswith("finally {"):
                    S += [f"say(name + \" {label} finally\");"] + ([f"await {r.choice(['null', 'gate()', '0'])};"] if r.random() < 0.5 else []) + ["}"]
            elif c < 0.62 and depth > 0:
                i = self.fresh("i")
                S += [f"for (let {i} = 0; {i} < {r.randint(1, 3)}; {i}++) {{"] + self.body(me, depth - 1, label + "l") + ["}"]
            elif c < 0.68:
                S.append(r.choice(["young();", "collect();", "churn(k);", "churn(k); young();"]))
            elif c < 0.74:
                S.append(f"queueMicrotask(() => say(name + \" {label} microtask\"));")
            elif c < 0.80:
                S.append(f"void Promise.resolve().then(() => say(name + \" {label} then\"));")
            elif c < 0.86:
                S.append(f"await {r.choice(['null', 'undefined', 'gate()', '0', 'Promise.resolve()'])}; say(name + \" {label} on\");")
            elif c < 0.92 and depth > 0:
                x = self.fresh("x")
                src = r.choice(["counting(k, 3)", "[gateWith(1), 2, Promise.resolve(3)]", "[1, 2]", "counting(k, 2)", "failingCount(k)"])
                S += [f"for await (const {x} of {src}) {{ total += {x}; say(name + \" {label} item \" + num({x}));"] + (["break;"] if r.random() < 0.2 else []) + ["}"]
            elif c < 0.96:
                S.append(f"if (k % {r.randint(2, 4)} === 0) throw new Error(name + \" {label} threw\");")
            else:
                S.append(f"if (k % 3 === 1) return {r.choice(['total', 'await gateWith(total)', 'gateWith(total)', 'Promise.resolve(total)', 'thenable(total, 1) as Promise<number>'])};")
        return S

    def function(self, i):
        r = self.r
        name = f"f{i}"
        decls, uses = self.locals()
        style = r.choice(["function", "function", "arrow", "method"])
        head = {"function": f"async function {name}(k: number, depth: number): Promise<number> {{", "arrow": f"const {name} = async (k: number, depth: number): Promise<number> => {{", "method": f"async function {name}(k: number, depth: number): Promise<number> {{ return host.m{i}(k, depth); }}"}[style]
        inner = [f'const name = "{name}#" + k; let total = 0;', "if (depth <= 0) { say(name + \" bottom\"); return k; }", f"say(name + \" starts\");"] + decls + self.body(name, 2, "s")
        inner.append("say(name + \" ends \" + num(total)" + ("".join(f" + \",\" + {u}" for u in uses)) + ");")
        inner.append(r.choice(["return total;", "return total + 1;", "return await Promise.resolve(total);", "return Promise.resolve(total);", "return gateWith(total);"]))
        self.fns.append(name)
        if style == "method":
            return [head], [f"  async m{i}(k: number, depth: number): Promise<number> {{"] + ["    " + s for s in inner] + ["  }"]
        return [head] + ["  " + s for s in inner] + ["}" + (";" if style == "arrow" else "")], []

    def program(self):
        r = self.r
        L = [f"// async-code-order.py seed {self.seed}", HEAD]
        L.append("async function* counting(k: number, n: number): AsyncGenerator<number, void, unknown> { try { for (let i = 0; i < n; i++) { say(\"counting \" + k + \" \" + i); if (i % 2) await gate(); yield k + i; } } finally { say(\"counting \" + k + \" closed\"); } }")
        L.append("async function* failingCount(k: number): AsyncGenerator<number, void, unknown> { yield k; await null; throw new Error(\"failingCount \" + k); }")
        methods = []
        texts = []
        for i in range(r.randint(4, 10)):
            t, m = self.function(i)
            texts += t
            methods += m
        L.append("class Host {")
        L += methods
        L.append("}")
        L.append("const host = new Host();")
        L += texts
        L.append("async function main(): Promise<void> {")
        L.append("  const started: Promise<string>[] = [];")
        for round in range(r.randint(1, 3)):
            for f in self.fns:
                if r.random() < 0.8:
                    L.append(f"  started.push({f}({r.randint(0, 6)}, {r.randint(1, 2)}).then(x => \"{f} gave \" + num(x), e => \"{f} failed \" + text(e)));")
            L.append(f"  say(\"-- round {round} started\");")
            L.append("  for (let spins = 0; spins < 60; spins++) { const now = gates; gates = []; say(\"-- opening \" + now.length); for (const open of now) open(); for (let t = 0; t < " + str(r.randint(1, 6)) + "; t++) await null; if (!now.length && !gates.length && spins > 3) break; }")
        L.append("  const results: string[] = started.map(() => \"pending\"); started.forEach((p, i) => { void p.then(s => { results[i] = s; }); });")
        L.append("  for (let spins = 0, idle = 0; spins < 400 && idle < 3; spins++) { const now = gates; gates = []; idle = now.length ? 0 : idle + 1; for (const open of now) open(); for (let t = 0; t < 40; t++) await null; }")
        L.append("  for (const s of results) say(s);")
        L.append("}")
        L.append('main().then(() => { console.log(log.join("\\n")); }, e => { console.log(log.join("\\n")); console.log("main failed " + text(e)); });')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
