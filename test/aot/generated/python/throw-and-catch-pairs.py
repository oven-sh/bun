#!/usr/bin/env python3
"""throw-and-catch-pairs.py <seed>: random strict TypeScript programs about WHAT IS THROWN AND WHO CATCHES IT: values of every kind (errors, heirs of Error, plain objects, numbers, strings, undefined, null, symbols, functions, frozen objects, the same
object twice) thrown in compiled code, by the engine (a read off null, a call of no function, a dead zone, a bad length, BigInt mixing, JSON.parse, a stack that overflows) and by host functions; through zero to five compiled frames (inlined or not, recursive), and
through the engine's own frames: callbacks of map | forEach | sort | reduce | replace | JSON.stringify | Array.from | Reflect.apply | Promise executors, getters, setters, Proxy traps, valueOf | toString | Symbol.toPrimitive, iterators (next | return that
throw, IteratorClose), generators (throw() into them, finally that yields), constructors, field initializers, default parameters, destructuring, tagged templates; caught at once, far up, rethrown, replaced in catch, overridden by finally (return | break | continue |
throw), caught without a binding, by async functions (rejections, awaits in catch and finally). What is logged: the order of everything, the identity of what was caught (=== what was thrown), its message, name, own keys, and that `stack` is a string."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
if (G.process) G.process.on("unhandledRejection", () => {});
const log: string[] = [];
function say(s: string): void { if (log.length < 5000) log.push(s); }
class Mine extends Error { code: number; constructor(m: string, code: number) { super(m); this.code = code; this.name = "Mine"; } }
class Deeper extends Mine { extra = "x"; }
const shared = { tag: "shared" };
const frozen = Object.freeze({ tag: "frozen" });
const kept: unknown[] = [];
function q(x: any): string {
  if (x === undefined) return "undef"; if (x === null) return "null"; if (typeof x === "string") return "'" + x + "'"; if (typeof x === "symbol") return x.toString(); if (typeof x === "function") return "fn"; if (typeof x === "bigint") return x + "n";
  if (x instanceof Error) return x.constructor.name + "/" + x.name + "(" + (x instanceof Mine || x.constructor === Error ? x.message : "..") + ")" + Object.keys(x).join("+") + (typeof x.stack === "string" ? "" : " NO STACK") + (x.cause !== undefined ? " cause " + q(x.cause) : "");
  if (Array.isArray(x)) return "[" + x.map(q).join() + "]"; if (typeof x === "object") return "{" + Object.keys(x).map(k => k + ":" + q(x[k])).join() + "}"; return Object.is(x, -0) ? "-0" : String(x);
}
function same(e: unknown): string { const i = kept.indexOf(e); return i < 0 ? "new" : "kept" + i; }
function thrown<T>(v: T): T { kept.push(v); return v; }
let depthLeft = 0;
function overflow(n: number): number { return overflow(n + 1) + 1; }
'''

VALUES = ['new Error("e" + k)', 'new Mine("m" + k, k)', 'new Deeper("d", 2)', 'new TypeError("t")', 'new RangeError("r")', '{ plain: k }', 'k', '"text" + k', 'undefined', 'null', 'Symbol.for("s")', '() => k', 'shared', 'frozen', '0', '""', 'NaN', '-0', 'false', '[k]', '10n',
          'new Error("with cause", { cause: shared })', 'Object.assign(new Error("decorated"), { extra: k })', 'new AggregateError([new Error("inner")], "agg")', 'Object.create(null)', 'new Proxy({ p: 1 }, {})', 'Promise.resolve(1)']
ENGINE = ['(null as any).x', '(undefined as any).y.z', '(5 as any)()', '({} as any).m()', 'new (5 as any)()', 'new Array(-1)', '(1n as any) + 1', 'JSON.parse("{")', '"a".repeat(-1)', 'overflow(0)', '(() => { const read = () => late; read(); let late = 1; return late; })()', '(Symbol() as any) + ""', 'null[Symbol.iterator as never]',
          '[...(5 as any)]', 'new (class A { constructor() { (this as any).x.y; } })()', 'Object.defineProperty(frozen, "z", { value: 1 })', '(frozen as any).tag = 1',
          'decodeURIComponent("%")', 'new Intl.NumberFormat("xx-invalid-locale-zzzz")', '(123.456).toFixed(101)', 'BigInt(1.5)', 'new WeakMap().set(1 as any, 1)', 'Reflect.ownKeys(1 as any)', '"x" in (1 as any)', '({}) instanceof (5 as any)']


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0

    def fresh(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def throw_now(self):
        r = self.r
        if r.random() < 0.6: return f"throw thrown({r.choice(VALUES)});"
        return f"{r.choice(ENGINE)};"

    def through(self, call):
        """The call goes through a frame of the engine's own."""
        r = self.r
        return r.choice([
            f"[1, 2].map(() => {call})", f"[1].forEach(() => {{ {call}; }})", f"[2, 1].sort(() => {{ {call}; return 0; }})", f"[1, 2].reduce((a) => {{ {call}; return a; }})", f"\"ab\".replace(/a/, () => {{ {call}; return \"\"; }})", f"JSON.stringify({{ toJSON() {{ {call}; }} }})",
            f"Array.from([1], () => {call})", f"Reflect.apply(() => {call}, null, [])", f"new Promise(() => {{ {call}; }})", f"({{ get g() {{ {call}; return 1; }} }}).g", f"({{ set s(v: number) {{ {call}; }} }}).s = 1", f"(new Proxy({{}}, {{ get() {{ {call}; return 1; }} }}) as any).any",
            f"+({{ valueOf() {{ {call}; return 1; }} }} as any)", f"`${{{{ toString() {{ {call}; return \"\"; }} }}}}`", f"String({{ [Symbol.toPrimitive]() {{ {call}; return \"\"; }} }})", f"[...{{ [Symbol.iterator]() {{ return {{ next() {{ {call}; return {{ done: true, value: 1 }}; }} }}; }} }}]",
            f"new (class {{ f = (() => {{ {call}; return 1; }})(); }})()", f"((a = (() => {{ {call}; return 1; }})()) => a)()", f"(([a = (() => {{ {call}; return 1; }})()]: number[]) => a)([])", f"((s: TemplateStringsArray) => {{ {call}; }})`t`", f"new Map([[1, 1]]).forEach(() => {{ {call}; }})",
            f"[1].find(() => {{ {call}; return true; }})", f"Object.defineProperty({{}}, \"x\", {{ get value() {{ {call}; return 1; }} }})", f"(function* () {{ {call}; yield 1; }})().next()", f"[1, 2, 3].flatMap(() => {{ {call}; return []; }})", f"JSON.parse(\"[1]\", () => {{ {call}; }})", f"{call}",
        ])

    def body(self, depth, callees):
        r = self.r
        L = []
        for _ in range(r.randint(1, 3)):
            c = r.random()
            tag = self.fresh("p")
            if c < 0.20: L.append(f"if (k % {r.randint(1, 3)} === 0) {{ say(\"{tag} throws\"); {self.throw_now()} }}")
            elif c < 0.45 and callees:
                call = f"{r.choice(callees)}(k + {r.randint(0, 2)})"
                L.append(f"say(\"{tag} \" + q({self.through(call)}));" if r.random() < 0.6 else f"{self.through(call)};")
            elif c < 0.80 and depth > 0:
                inner = self.body(depth - 1, callees)
                kind = r.random()
                e = self.fresh("e")
                after = r.choice(["", "", f"throw {e};", f"throw thrown(new Error(\"replaced\", {{ cause: {e} }}));", f"return \"{tag} from catch\";", f"kept.push({e});", f"{self.throw_now()}", "collect();", f"if ({e} instanceof Mine) throw {e};"])
                fin = r.choice(["", "", "", f"return \"{tag} from finally\";", f"if (k > 1) return \"{tag} late\";", f"throw thrown(\"{tag} finally throws\");" if r.random() < 0.3 else "", "collect();"])
                if kind < 0.45: L += ["try {"] + inner + [f"}} catch ({e}) {{ say(\"{tag} caught \" + q({e}) + \" \" + same({e})); {after} }}"]
                elif kind < 0.60: L += ["try {"] + inner + [f"}} finally {{ say(\"{tag} finally\"); {fin} }}"]
                elif kind < 0.85: L += ["try {"] + inner + [f"}} catch ({e}) {{ say(\"{tag} caught \" + q({e}) + \" \" + same({e})); {after} }} finally {{ say(\"{tag} finally\"); {fin} }}"]
                elif kind < 0.92: L += ["try {"] + inner + [f"}} catch {{ say(\"{tag} caught something\"); }}"]
                else:
                    i = self.fresh("i")
                    L += [f"for (let {i} = 0; {i} < 3; {i}++) {{ try {{ if ({i} === 1) {{ {self.throw_now()} }}"] + inner + [f"}} catch ({e}) {{ say(\"{tag} loop caught \" + q({e})); {r.choice(['continue;', 'break;', ''])} }} finally {{ say(\"{tag} loop finally \" + {i}); {r.choice(['', '', 'if (' + i + ' === 2) break;', 'continue;'])} }} }}"]
            elif c < 0.86:
                L += [('for (const x of { [Symbol.iterator]() { let n = 0; return { next() { return { done: n++ > 2, value: n }; }, return() { say("' + str(tag) + ' closed"); ' + str(r.choice(['', '', 'throw thrown("close throws");'])) + ' return { done: true, value: 0 }; } }; } }) { if (x === 2) { ' + str(self.throw_now()) + ' } }')]
            elif c < 0.92:
                g = self.fresh("g")
                L += [f"{{ const {g} = (function* () {{ try {{ yield 1; yield 2; }} catch (e) {{ say(\"{tag} generator caught \" + q(e) + \" \" + same(e)); {r.choice(['', 'throw e;', 'yield 9;'])} }} finally {{ say(\"{tag} generator finally\"); }} }})(); {g}.next(); say(\"{tag} \" + q({g}.throw(thrown({r.choice(VALUES)})))); }}"]
            else: L.append(f"say(\"{tag}\");")
        return L

    def function(self, i):
        r = self.r
        callees = [f"f{j}" for j in range(i)][-4:]
        L = [f"function f{i}(k: number): unknown {{"] + ["  " + s for s in self.body(2, callees)] + [f"  return \"f{i} done\";", "}"]
        return L

    def async_function(self, i, n):
        r = self.r
        callee = f"f{r.randrange(n)}"
        e = self.fresh("e")
        return [f"async function a{i}(k: number): Promise<unknown> {{",
                f"  try {{ {r.choice(['await null;', '', 'await Promise.reject(thrown(' + r.choice(VALUES) + '));', 'await Promise.resolve().then(() => { ' + self.throw_now() + ' });'])} say(\"a{i} \" + q({callee}(k))); {r.choice(['', 'await null;', self.throw_now()])} }}",
                f"  catch ({e}) {{ say(\"a{i} caught \" + q({e}) + \" \" + same({e})); {r.choice(['', 'await null;', 'throw ' + e + ';', 'return ' + e + ';'])} }}",
                f"  finally {{ say(\"a{i} finally\"); {r.choice(['', 'await null;', ''])} }}", f"  return \"a{i} done\";", "}"]

    def program(self):
        r = self.r
        L = [f"// throw-and-catch-pairs.py seed {self.seed}", HEAD]
        n = r.randint(4, 10)
        for i in range(n): L += self.function(i)
        m = r.randint(0, 3)
        for i in range(m): L += self.async_function(i, n)
        L.append("async function main(): Promise<void> {")
        L.append(f"  for (let k = 0; k < {r.choice([2, 3, 4])}; k++) {{")
        for i in range(n): L.append(f"    try {{ say(\"f{i} -> \" + q(f{i}(k))); }} catch (e) {{ say(\"f{i} !! \" + q(e) + \" \" + same(e)); }}")
        for i in range(m): L.append(f"    try {{ say(\"a{i} -> \" + q(await a{i}(k))); }} catch (e) {{ say(\"a{i} !! \" + q(e) + \" \" + same(e)); }}")
        L.append("    kept.length = 0;")
        L.append("  }")
        L.append("}")
        L.append('main().then(() => console.log(log.join("\\n")), e => { console.log(log.join("\\n")); console.log("main failed " + q(e)); });')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
