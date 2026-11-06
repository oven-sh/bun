#!/usr/bin/env python3
"""control-flow.py <seed>: random strict TypeScript programs about control flow and the order of evaluation: try | catch | finally nested in loops, switches and labelled blocks, left by return, break,
continue and throw from every part; for-of over arrays, strings, Maps, Sets, generators and hand-made iterators that log next() and return(); generators with try | finally that are returned from, thrown into, delegated to;
closures made in loops that capture the loop's variables; destructuring with defaults, rests, holes and nested patterns over logging iterators and getters; compound assignments, ++ and -- on members and elements whose object, key and value log;
optional chains and ?? || && and their assignments that must not evaluate what they skip; arguments evaluated left to right."""
import random, sys, os

HEAD = r'''const log: string[] = [];
function say(s: string): void { log.push(s); }
function t<T>(label: string, value: T): T { log.push(label); return value; }
function num(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "string" ? "'" + x + "'" : Array.isArray(x) ? "[" + x.map(num).join() + "]" : String(x); }
function attempt(f: () => unknown): string { try { return num(f()); } catch (e) { return "threw " + (e instanceof Error ? e.constructor.name + ":" + e.message : num(e)); } }
function counter(name: string, n: number, failAt = -1): Iterable<number> & { closed: number } {
  const self = { closed: 0, [Symbol.iterator](): Iterator<number> {
    let i = 0;
    return { next(): IteratorResult<number> { say(name + ".next" + i); if (i === failAt) throw new Error(name + " failed"); return i < n ? { value: i++, done: false } : { value: undefined, done: true }; },
      return(v?: unknown): IteratorResult<number> { say(name + ".return"); self.closed++; return { value: v as any, done: true }; } };
  } };
  return self;
}
function* gen(name: string, n: number): Generator<number, string, unknown> { try { for (let i = 0; i < n; i++) { say(name + " yields " + i); const got = yield i; if (got !== undefined) say(name + " got " + num(got)); } return name + " done"; } finally { say(name + " finally"); } }
class Box { v = 1; w = 10; list = [1, 2, 3]; inner: Box | null = null; get g(): number { say("get g"); return this.v; } set g(x: number) { say("set g " + x); this.v = x; } m(x: number): number { say("m " + x); return x + this.v; } }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    # ---- statements that may leave: ctx = dict(loop: [labels], fn: True)
    def leave(self, ctx):
        r = self.r
        c = ["return"] * 2 + ["throw"] * 2
        if ctx["loops"]: c += ["break", "continue", "break_label", "continue_label"] * 2
        if ctx["blocks"]: c += ["breakb"] * 2
        k = r.choice(c)
        cond = r.choice(["k % 2 === 0", "k % 3 === 1", "k > 1", "n > 2", "n === 1", "true", "k === 0"])
        act = {"return": f'return "r{self.fresh("")}"', "throw": f'throw new Error("e{self.fresh("")}")', "break": "break", "continue": "continue",
               "break_label": f"break {r.choice(ctx['loops'])}" if ctx["loops"] else "", "continue_label": f"continue {r.choice(ctx['loops'])}" if ctx["loops"] else "", "breakb": f"break {r.choice(ctx['blocks'])}" if ctx["blocks"] else ""}[k]
        return f"if ({cond}) {act};"

    def block(self, ctx, depth):
        r = self.r
        S = []
        for _ in range(r.randint(1, 4)):
            c = r.random()
            tag = self.fresh("s")
            if c < 0.22 or depth <= 0:
                S.append(f'say("{tag}"); n++;')
            elif c < 0.38:
                S.append(self.leave(ctx))
            elif c < 0.58:
                S += ["try {"] + self.block(ctx, depth - 1)
                form = r.random()
                if form < 0.65: S += [f'}} catch (e) {{ say("{tag} caught " + (e as Error).message);'] + (self.block(ctx, depth - 1) if r.random() < 0.6 else [])
                if form > 0.35: S += [f'}} finally {{ say("{tag} finally");'] + (self.block(ctx, depth - 1) if r.random() < 0.6 else [])
                S.append("}")
            elif c < 0.78:
                label = self.fresh("L")
                i = self.fresh("i")
                head = r.choice([
                    f"for (let {i} = 0; {i} < {r.randint(1, 3)}; {i}++)", f"for (const {i} of [1, 2, 3])", f'for (const {i} of counter("{tag}", {r.randint(0, 3)}))', f'for (const {i} of gen("{tag}", {r.randint(0, 3)}))', f'for (const {i} of "ab")',
                    f"for (const {i} of new Set([1, 2]))", f"for (const [{i}] of new Map([[1, 2], [3, 4]]))", f'for (const {i} in {{ a: 1, b: 2 }})', f"let {i} = 0; while ({i}++ < {r.randint(1, 3)})", f"let {i} = 0; do", f'for (const {i} of counter("{tag}", 3, {r.randint(0, 3)}))'])
                inner = dict(ctx, loops=ctx["loops"] + [label])
                if head.startswith("let"):
                    decl, loop = head.split("; ", 1)
                    S += [f"{{ {decl};", f"{label}: {loop} {{"] + self.block(inner, depth - 1) + ["}" + (f" while ({i}++ < 2);" if loop == "do" else ""), "}"]
                else:
                    S += [f"{label}: {head} {{"] + self.block(inner, depth - 1) + ["}"]
            elif c < 0.86:
                label = self.fresh("B")
                S += [f"{label}: {{"] + self.block(dict(ctx, blocks=ctx["blocks"] + [label]), depth - 1) + ["}"]
            elif c < 0.93:
                label = self.fresh("B")
                inner = dict(ctx, blocks=ctx["blocks"] + [label])
                S += [f"{label}: switch (n % 3) {{", "case 0:"] + self.block(inner, depth - 1) + ["case 1:"] + self.block(inner, depth - 1) + [r.choice(["break;", ""]), "default:"] + self.block(inner, depth - 1) + ["}"]
            else:
                S += [f"if (n % 2) {{"] + self.block(ctx, depth - 1) + ["} else {"] + self.block(ctx, depth - 1) + ["}"]
        return S

    def flow_function(self, k):
        L = [f"function f{k}(k: number): string {{", "  let n = 0;"] + ["  " + s for s in self.block({"loops": [], "blocks": []}, 3)] + ['  return "end" + n;', "}"]
        return L, [f'say("f{k} " + attempt(() => f{k}({a})));' for a in (0, 1, 2, 3)]

    def expression_row(self):
        r = self.r
        b = "t(\"b\", box)"
        return r.choice([
            f"{b}.v += t(\"rhs\", 2)", f"{b}.list[t(\"i\", 1)] += t(\"rhs\", 5)", f"{b}.list[t(\"i\", 0)]++", f"--{b}.list[t(\"i\", 2)]", f"{b}.g += t(\"rhs\", 3)", f"{b}.g++", f"{b}.v = t(\"a\", 1) + t(\"b2\", 2) * t(\"c\", 3)", f"{b}.m(t(\"x\", 1)) + {b}.m(t(\"y\", 2))",
            f"{b}.inner?.m(t(\"skipped\", 1))", f"{b}.inner?.list[t(\"skipped\", 0)]", f"({b}.inner ?? t(\"fallback\", box)).v", f"{b}.inner?.inner?.v ?? t(\"dflt\", -1)", f"{b}.v ||= t(\"skipped\", 9)", f"{b}.v &&= t(\"taken\", 9)", f"{b}.inner ??= t(\"made\", new Box())",
            f"maybe?.(t(\"skipped\", 1))", f"maybe?.(t(\"skipped\", 1)) ?? t(\"dflt\", 0)", f"[t(\"a\", 1), t(\"b2\", 2), ...t(\"c\", [3, 4]), t(\"d\", 5)]", f"({{ a: t(\"a\", 1), [t(\"key\", \"k\")]: t(\"v\", 2), ...t(\"s\", {{ z: 3 }}) }}).k", f"t(\"f\", add3)(t(\"a\", 1), t(\"b2\", 2), t(\"c\", 3))",
            f"t(\"l\", 1) < t(\"r\", 2) ? t(\"yes\", 1) : t(\"no\", 0)", f"(t(\"a\", 0) || t(\"b2\", 0) || t(\"c\", 3)) && t(\"d\", 4)", f"`${{t(\"a\", 1)}}-${{t(\"b2\", \"x\")}}-${{t(\"c\", null)}}`", f"t(\"base\", 2) ** t(\"exp\", 3) ** t(\"exp2\", 2)", f"delete (t(\"o\", {{ a: 1 }}) as any)[t(\"key\", \"a\")]",
            f"t(\"key\", \"v\") in t(\"o\", box)", f"(t(\"a\", 1), t(\"b2\", 2), t(\"c\", 3))", f"typeof t(\"x\", box).m", f"{b}.list.length = t(\"len\", 1)", f"new (t(\"C\", Box))().v + t(\"after\", 1)", f"{b}.list[{b}.v] = {b}.list[t(\"j\", 0)] + t(\"k\", 1)", f"void t(\"x\", 1)",
            f"{b}[t(\"name\", \"v\") as \"v\"] *= t(\"rhs\", 4)", f"tag`a${{t(\"x\", 1)}}b${{t(\"y\", 2)}}c`", f"{b}.v = {b}.w = t(\"rhs\", 7)", f"[{b}.v, {b}.w] = [t(\"p\", 5), t(\"q\", 6)]", f"({{ v: {b}.w, w: {b}.v }} = t(\"src\", {{ v: 8, w: 9 }}))",
        ])

    def pattern_row(self):
        r = self.r
        src = r.choice(['counter("c", 4)', 'counter("c", 1)', 'counter("c", 0)', 'gen("g", 3)', "[1, 2, 3, 4]", "[undefined, null, 0]", '"xyz"', "new Set([7, 8])", 'counter("c", 3, 1)'])
        pat = r.choice(["[a]", "[a, b]", "[a, , b]", "[a, ...rest]", "[, , a]", "[a = t(\"da\", 10), b = t(\"db\", 20)]", "[a, b, c, d, e]", "[]", "[...rest]", "[a = t(\"da\", 1), ...rest]", "[[a] = [t(\"inner\", 5)], b]" if src in ("[undefined, null, 0]",) else "[a, b = a]"])
        names = [n for n in ("a", "b", "c", "d", "e", "rest") if (n + "]" in pat or n + "," in pat or n + " " in pat or n + "]" in pat)]
        shown = ", ".join(f"num({n})" for n in names) or '"none"'
        return f"attempt(() => {{ const {pat}: any = {src}; return [{shown}].join(\"/\"); }})"

    def object_pattern_row(self):
        r = self.r
        src = r.choice(["{ a: 1, b: 2, c: 3 }", "{ get a() { say(\"get a\"); return 1; }, get b() { say(\"get b\"); return undefined; }, c: null }", "{ a: undefined, b: { c: 5 } }", "box", "[10, 20]", '"str"', "{ }"])
        pat = r.choice(["{ a, b }", "{ b, a }", "{ a = t(\"da\", 10), b = t(\"db\", 20) }", "{ a, ...rest }", "{ [t(\"key\", \"a\")]: x, b }", "{ a: { c } = { c: t(\"dc\", 7) } }", "{ b: { c } = { c: t(\"dc\", 7) } }", "{ length }", "{ 0: first, 1: second }", "{ v, w, list: [h, ...tl] }" if src == "box" else "{ a: x = t(\"dx\", 1), c: y = t(\"dy\", 2) }"])
        import re
        names = sorted(set(re.findall(r"\b(a|b|c|x|y|rest|length|first|second|v|w|h|tl)\b(?=\s*(?:[,}\]=]|$))", pat)))
        names = [n for n in names if not re.search(r"\b" + n + r"\s*:", pat)]
        shown = ", ".join(f"(typeof {n} === \"object\" && {n} ? JSON.stringify({n}) : num({n}))" for n in names) or '"none"'
        return f"attempt(() => {{ const {pat}: any = {src}; return [{shown}].join(\"/\"); }})"

    def closure_row(self):
        r = self.r
        return r.choice([
            "attempt(() => { const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) { fs.push(() => i); } return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; for (let i = 0; i < 3; i++) { fs.push(() => i); i++; } return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; for (let i = 0; i < 6; fs.push(() => i), i += 2) { } return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; for (let i = 0, inc = () => i++; i < 3; inc()) { fs.push(() => i); if (fs.length > 5) break; } return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; for (const x of [1, 2, 3]) { let y = x * 2; fs.push(() => y++ + x); } return fs.map(f => f() + f()); })",
            "attempt(() => { const fs: (() => string)[] = []; for (const key in { a: 1, b: 2 }) fs.push(() => key); return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; let j = 0; while (j < 3) { const c = j; let m = j; fs.push(() => c * 10 + m++ + j); j++; } return fs.map(f => f() + f()); })",
            "attempt(() => { const fs: ((d: number) => number)[] = []; for (let i = 0; i < 3; i++) { fs.push(d => (i += d)); } return [fs[0](1), fs[0](1), fs[1](5), fs[2](0)]; })",
            "attempt(() => { let s = 0; const add = (x: number) => { s += x; return () => s; }; const a = add(1), b = add(2); s = 10; return [a(), b()]; })",
            "attempt(() => { const made: (() => number)[] = []; function outer(n: number): void { if (n > 0) { made.push(() => n); outer(n - 1); } } outer(3); return made.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) fs.push(() => i * 10 + j); return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; try { for (let i = 0; ; i++) { fs.push(() => i); if (i === 2) throw new Error(\"x\"); } } catch { } return fs.map(f => f()); })",
            "attempt(() => { const fs: (() => number)[] = []; switch (1 as number) { case 1: { let z = 5; fs.push(() => z++); } case 2: { let z = 50; fs.push(() => z++); } } return fs.map(f => f() + f()); })",
        ])

    def generator_row(self):
        r = self.r
        n = r.randint(0, 3)
        return r.choice([
            f'attempt(() => {{ const g = gen("g", {n}); return [g.next(), g.next("x"), g.return("early"), g.next()].map(x => num(x.value) + x.done); }})',
            f'attempt(() => {{ const g = gen("g", {n}); g.next(); return attempt(() => g.throw(new Error("in"))) + num(g.next().done); }})',
            f'attempt(() => {{ function* outer(): Generator<number, string, unknown> {{ const r = yield* gen("in", {n}); say("inner gave " + r); yield 99; return "outer"; }} return [...outer()]; }})',
            f'attempt(() => {{ function* outer(): Generator<number, void, unknown> {{ try {{ yield* gen("in", 3); }} finally {{ say("outer finally"); }} }} const g = outer(); g.next(); g.next(); return num(g.return().done); }})',
            f'attempt(() => {{ const g = gen("g", 3); const [a] = g; return [a, g.next().done]; }})',
            f'attempt(() => {{ const g = gen("g", 2); return [Math.max(...g), g.next().done]; }})',
            f'attempt(() => {{ function* f(): Generator<number, number, number> {{ const a = yield 1; const b = yield a + 1; return a + b; }} const g = f(); return [g.next(5).value, g.next(10).value, g.next(20).value]; }})',
            f'attempt(() => {{ function* f(): Generator<number> {{ try {{ yield 1; }} finally {{ yield 2; say("after 2"); }} }} const g = f(); return [g.next().value, g.return(7).value, g.next().value, g.next().done]; }})',
            f'attempt(() => {{ function* f(): Generator<number> {{ try {{ yield 1; throw new Error("boom"); }} catch (e) {{ yield 2; }} finally {{ say("fin"); }} yield 3; }} return [...f()]; }})',
            f'attempt(() => {{ const g = gen("g", 1); return [g[Symbol.iterator]() === g, typeof g.next, Object.prototype.toString.call(g)]; }})',
            f'attempt(() => {{ function* f(): Generator<number> {{ yield* [1, 2]; yield* "ab" as any; yield* counter("c", 2); }} return [...f()]; }})',
            f'attempt(() => {{ function* f(): Generator<number> {{ yield* counter("c", 5); }} const g = f(); g.next(); g.next(); return num(g.return(1).value); }})',
        ])

    def program(self):
        r = self.r
        L = [f"// control-flow.py seed {self.seed}", HEAD, "function add3(a: number, b: number, c: number): number { return a * 100 + b * 10 + c; }", "const maybe: ((x: number) => number) | undefined = undefined as ((x: number) => number) | undefined;",
             "function tag(strings: TemplateStringsArray, ...values: unknown[]): string { return strings.join(\"|\") + values.join(\",\") + strings.raw.length; }"]
        calls = []
        for k in range(r.randint(3, 8)):
            text, c = self.flow_function(k)
            L += text
            calls += c
        L.append("function rows(): void {")
        L.append("  let box = new Box();")
        for i in range(r.randint(15, 45)):
            c = r.random()
            if c < 0.40: L.append(f"  box = new Box(); say(\"x{i} \" + attempt(() => {self.expression_row()}) + \" \" + box.v + \",\" + box.w + \",\" + box.list.join(\"_\") + \",\" + (box.inner !== null));")
            elif c < 0.55: L.append(f"  say(\"p{i} \" + {self.pattern_row()});")
            elif c < 0.70: L.append(f"  say(\"o{i} \" + {self.object_pattern_row()});")
            elif c < 0.82: L.append(f"  say(\"c{i} \" + {self.closure_row()});")
            else: L.append(f"  say(\"g{i} \" + {self.generator_row()});")
        L.append("}")
        L += calls
        L.append("rows(); rows();")
        L.append('console.log(log.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
