#!/usr/bin/env python3
"""calls-by-value.py <seed>: random strict TypeScript programs about calls by value: functions of every kind (declarations, arrows that capture,
methods taken off their object, static methods, bound functions, defaults, rest and optional parameters, host functions, functions with properties, classes called without new,
functions that read `this` or `arguments`) handed to typed callback parameters, kept in members, arrays and maps, and called with every argument count, by call | apply | spread |
optional call, by the built-ins that take callbacks, from sites that see one kind and sites that see all."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function num(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x + ":" + String(x); }
function attempt(f: () => unknown): string { try { return num(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "thrown " + String(e); } }
type F0 = () => number;
type F1 = (a: number) => number;
type F2 = (a: number, b: number) => number;
type F3 = (a: number, b: number, c: number) => number;
type F5 = (a: number, b: number, c: number, d: number, e: number) => number;
type F8 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
let moduleCount = 0;
class Acc {
  total = 1; name = "acc";
  add(a: number, b: number): number { this.total += a; return this.total + b; }
  one(a: number): number { return this.total * a; }
  none(): number { return ++this.total; }
  arrow = (a: number, b: number): number => this.total + a - b;
  static twice(a: number): number { return a * 2; }
  static sum(a: number, b: number, c: number): number { return a + b + c; }
  get getter(): F1 { return x => x + this.total; }
}
class Sub extends Acc { add(a: number, b: number): number { return super.add(a, b) * 2; } one(a: number): number { return -a; } }
function d0(): number { return ++moduleCount; }
function d1(a: number): number { return a + 1; }
function d2(a: number, b: number): number { return a * 10 + b; }
function d3(a: number, b: number, c: number): number { return a * 100 + b * 10 + c; }
function d5(a: number, b: number, c: number, d: number, e: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5; }
function d8(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number { return a + b * 2 + c * 3 + d * 4 + e * 5 + f * 6 + g * 7 + h * 8; }
function withDefault(a: number, b = 7): number { return a * b; }
function withThreeDefaults(a = 1, b = a + 1, c = b + 1): number { return a * 100 + b * 10 + c; }
function withOptional(a: number, b?: number): number { return b === undefined ? -a : a + b; }
function withRest(...all: number[]): number { let s = all.length * 1000; for (const x of all) s += x; return s; }
function oneAndRest(a: number, ...rest: number[]): number { return a * 100 + rest.length; }
function counts(this: unknown, a?: number, b?: number): number { return arguments.length * 10 + (a ?? 0) + (b ?? 0); }
function readsThis(this: unknown, a: number): number { return (this === undefined ? 1000 : typeof this === "object" ? 2000 : 3000) + a; }
function doubles(a: number, b: number): number { return a / 3 + b / 7; }
function throws(a: number): number { if (a > 2) throw new RangeError("too big"); return a; }
function recursive(a: number): number { return a <= 0 ? 0 : a + recursive(a - 1); }
const withProperties: F1 & { calls: number } = Object.assign((a: number) => a + 5, { calls: 0 });
function makeAdder(k: number): F1 { return x => x + k; }
function makeCounter(): F0 { let n = 0; return () => ++n; }
function makeDeep(a: number, b: number, c: number): F2 { return (x, y) => a * x + b * y + c; }
type P = (x: number) => boolean;
type Q = (x: number) => unknown;
function isEven(x: number): boolean { return x % 2 === 0; }
function isBig(x: number): boolean { return x > 2; }
function never(_: number): boolean { return false; }
function always(): boolean { return true; }
function countIf(xs: number[], p: P): number { let n = 0; for (const x of xs) if (p(x)) n++; return n; }
function countUnless(xs: number[], p: P): number { let n = 0; for (const x of xs) if (!p(x)) n++; return n; }
function countLoose(xs: number[], p: Q): number { let n = 0; for (const x of xs) if (p(x)) n++; return n; }
function firstThat(xs: number[], p: P): number { for (const x of xs) { const yes = p(x); if (yes === true) return x; } return -1; }
function answers(xs: number[], p: P): string { return xs.map(x => String(p(x)) + typeof p(x)).join(); }
function looseAnswers(xs: number[], p: Q): string { return xs.map(x => { const a = p(x); return (a ? "T" : "F") + typeof a; }).join(); }
function bothOf(p: P, q: P): P { return x => p(x) && q(x); }
function eitherOf(p: P, q: P): P { return x => p(x) || q(x); }
function notOf(p: P): P { return x => !p(x); }
class Filter { limit = 2; test(x: number): boolean { return x > this.limit; } arrow = (x: number): boolean => x < this.limit; }
async function asyncOne(a: number): Promise<number> { await null; return a + 1; }
function* genOne(a: number): Generator<number, number, unknown> { yield a; return a + 1; }
'''

POOLS = {
    0: ["d0", "withRest", "withThreeDefaults", "makeCounter()", "() => 4", "() => moduleCount", "acc.none.bind(acc)", "Math.random.bind(null) && d0", "counts", "d1.bind(null, 4)", "d2.bind(null, 4, 5)", "() => acc.total", "sub.none.bind(sub)"],
    1: ["d1", "makeAdder(3)", "makeAdder(k)", "x => x * 2", "x => -x", "Math.abs", "Math.sqrt", "Math.floor", "Math.round", "Math.trunc", "Acc.twice", "acc.one.bind(acc)", "sub.one", "acc.getter", "withProperties", "withDefault", "withOptional",
        "withRest", "oneAndRest", "counts", "readsThis", "throws", "recursive", "Number", "d2.bind(null, 1)", "d3.bind(null, 1, 2)", "x => x + moduleCount", "(x: number) => { moduleCount++; return x; }", "Math.fround", "Math.clz32", "d0", "acc.one"],
    2: ["d2", "makeDeep(1, 2, 3)", "makeDeep(k, 0, 1)", "(x, y) => x - y", "(x, y) => y", "Math.max", "Math.min", "Math.pow", "Math.atan2", "Math.imul", "Math.hypot", "acc.add.bind(acc)", "sub.add.bind(sub)", "acc.arrow", "sub.arrow", "withDefault", "withThreeDefaults",
        "withOptional", "withRest", "oneAndRest", "counts", "doubles", "d1", "d0", "d3.bind(null, 9)", "acc.add", "(x: number, y: number) => x * y + moduleCount", "x => x", "() => 1"],
    3: ["d3", "Acc.sum", "withThreeDefaults", "withRest", "oneAndRest", "(x, y, z) => x + y - z", "Math.max", "Math.min", "d2", "d1", "d0", "(x, y, z) => z", "d5.bind(null, 1, 2)", "counts"],
    5: ["d5", "withRest", "oneAndRest", "(a, b, c, d, e) => e * 2 + a", "Math.max", "d3", "d2", "(a, b, c, d, e) => a - b + c - d + e", "d8.bind(null, 1, 2, 3)"],
    8: ["d8", "withRest", "(a, b, c, d, e, f, g, h) => h - a", "Math.min", "d5", "(a, b, c, d, e, f, g, h) => a + b + c + d + e + f + g + h + 0.5", "oneAndRest"],
}
ARGS = ["1", "2", "3", "k", "0.5", "-0", "k + 0.25", "7", "-3", "2147483647", "1e10", "NaN", "k * 2"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.L = []

    def args(self, n):
        return ", ".join(self.r.choice(ARGS) for _ in range(n))

    def fn(self, n):
        return self.r.choice(POOLS[n])

    def callers(self):
        L, r = self.L, self.r
        for n in (0, 1, 2, 3, 5, 8):
            names = "abcdefgh"[:n]
            params = "".join(f", {c}: number" for c in names)
            plain = ", ".join(names)
            L.append(f"function call{n}(fn: F{n}{params}): number {{ return fn({plain}); }}")
            L.append(f"function twice{n}(fn: F{n}{params}): number {{ return fn({plain}) + fn({plain}); }}")
            L.append(f"function loop{n}(fn: F{n}{params}): number {{ let s = 0; for (let i = 0; i < 5; i++) s += fn({plain}); return s; }}")
            L.append(f"function maybe{n}(fn: F{n} | null | undefined{params}): number {{ return fn?.({plain}) ?? -1; }}")
            L.append(f"function byCall{n}(fn: F{n}{params}): number {{ return fn.call(undefined{''.join(', ' + c for c in names)}); }}")
            L.append(f"function byApply{n}(fn: F{n}{params}): number {{ return fn.apply(null, [{plain}]); }}")
            L.append(f"function bySpread{n}(fn: F{n}, all: [{', '.join('number' for _ in names)}]): number {{ return fn(...all); }}")
            L.append(f"class Holds{n} {{ fn: F{n}; gn: F{n} | null = null; constructor(fn: F{n}) {{ this.fn = fn; }} run({params[2:]}): number {{ return this.fn({plain}) + (this.gn ? this.gn({plain}) : 0); }} }}")
            L.append(f"function through{n}(fn: F{n}{params}): number {{ return call{n}(fn{''.join(', ' + c for c in names)}); }}")
            L.append(f"function keep{n}(fn: F{n}): F{n} {{ return fn; }}")
            L.append(f"function wrapped{n}(fn: F{n}): F{n} {{ return ({plain}) => fn({plain}) + 1; }}")

    PREDS = ["isEven", "isBig", "never", "always", "x => x > 1", "x => x === k", "x => !(x % 3)", "bothOf(isEven, isBig)", "eitherOf(isEven, never)", "notOf(isBig)", "notOf(notOf(isEven))", "new Filter().arrow", "(f => (x: number) => f.test(x))(new Filter())", "Number.isInteger", "Number.isNaN", "isFinite", "x => isEven(x) === isBig(x)",
             "k % 2 ? isEven : isBig", "k % 3 ? never : always", "[isEven, isBig, never][k % 3]", "Boolean", "x => Boolean(x)", "x => !!x", "x => x !== x"]
    LOOSE = ["x => x", "x => x - 1", "x => x % 2", "x => (x > 1 ? \"s\" : \"\")", "x => (x > 1 ? null : {})", "x => (x > 1 ? undefined : [])", "x => (x ? NaN : 1)", "x => (x > 1 ? -0 : 0.5)", "x => (x > 1 ? 0n : 1n)", "() => {}", "x => [x]", "x => String(x - 1)", "Math.floor", "x => x / 0", "x => Symbol.iterator", "isEven", "d1", "x => x > 1 && \"yes\""]

    def pred(self):
        r = self.r
        xs = r.choice(["[0, 1, 2, 3, 4]", "[1.5, 2.5, NaN]", "[k, k + 1, k + 2]", "([] as number[])", "[-0, 0, 1]", "[3, 3, 3]"])
        p, q = r.choice(self.PREDS), r.choice(self.LOOSE)
        return r.choice([
            f"attempt(() => countIf({xs}, {p}))", f"attempt(() => countUnless({xs}, {p}))", f"attempt(() => firstThat({xs}, {p}))", f"attempt(() => answers({xs}, {p}))", f"attempt(() => countLoose({xs}, {q}))", f"attempt(() => looseAnswers({xs}, {q}))", f"attempt(() => countLoose({xs}, {p}))",
            f"attempt(() => {xs}.filter({p}).join())", f"attempt(() => {xs}.filter({q}).join())", f"attempt(() => String({xs}.some({p})) + {xs}.every({p}))", f"attempt(() => String({xs}.some({q})) + {xs}.every({q}))", f"attempt(() => num({xs}.find({p})) + {xs}.findIndex({p}) + num({xs}.findLast({p})) + {xs}.findLastIndex({p}))",
            f"attempt(() => num({xs}.find({q})) + {xs}.findIndex({q}))", f"attempt(() => countIf({xs}, {p}) + countIf({xs}, {r.choice(self.PREDS)}))", f"attempt(() => {{ const ps: P[] = [{p}, {r.choice(self.PREDS)}, {r.choice(self.PREDS)}]; return ps.map(f => countIf({xs}, f)).join(); }})",
            f"attempt(() => {{ const f: P = {p}; return (f(1) ? 1 : 0) + (f(2) === true ? 10 : 0) + (f(3) == true ? 100 : 0) + Number(f(4)) * 1000 + (f(5) as unknown as number) * 1; }})", f"attempt(() => JSON.stringify({xs}.map({p})))", f"attempt(() => {{ const f: P = {p}; let n = 0; while (f(n) && n < 5) n++; return n; }})",
        ])

    def one(self):
        r = self.r
        if r.random() < 0.25: return self.pred()
        n = r.choice([0, 1, 1, 2, 2, 2, 3, 5, 8])
        f = self.fn(n)
        a = self.args(n)
        sep = ", " if n else ""
        c = r.random()
        if c < 0.16: return f"attempt(() => call{n}({f}{sep}{a}))"
        if c < 0.24: return f"attempt(() => twice{n}({f}{sep}{a}))"
        if c < 0.32: return f"attempt(() => loop{n}({f}{sep}{a}))"
        if c < 0.38: return f"attempt(() => maybe{n}({r.choice([f, f, 'null', 'undefined'])}{sep}{a}))"
        if c < 0.44: return f"attempt(() => byCall{n}({f}{sep}{a}))"
        if c < 0.50: return f"attempt(() => byApply{n}({f}{sep}{a}))"
        if c < 0.55: return f"attempt(() => bySpread{n}({f}, [{a}]))"
        if c < 0.63: return f"attempt(() => {{ const h = new Holds{n}({f}); h.gn = {r.choice([self.fn(n), 'null'])}; return h.run({a}) + h.run({self.args(n)}); }})"
        if c < 0.68: return f"attempt(() => through{n}({f}{sep}{a}))"
        if c < 0.73: return f"attempt(() => wrapped{n}(wrapped{n}({f}))({a}))"
        if c < 0.78: return f"attempt(() => {{ const fs: F{n}[] = [{', '.join(self.fn(n) for _ in range(r.randint(1, 6)))}]; let s = 0; for (const each of fs) s += call{n}(each{sep}{a}); return s; }})"
        if c < 0.81: return f"attempt(() => {{ const m = new Map<string, F{n}>(); m.set(\"a\", {f}); m.set(\"b\", {self.fn(n)}); collect(); return m.get(\"a\")!({a}) + m.get(\"b\")!({a}); }})"
        if c < 0.84: return f"attempt(() => (keep{n}({f}) as any)({self.args(r.randint(n, 9))}))"
        if c < 0.86: return f"attempt(() => call{n}(k % 2 ? {f} : {self.fn(n)}{sep}{a}))"
        b = r.random()
        f1, f2 = self.fn(1), self.fn(2)
        tame = lambda n: f"keep{n}(" + r.choice([x for x in POOLS[n] if not any(w in x for w in ("withRest", "oneAndRest", "withThreeDefaults"))]) + ")"
        t1, t2 = tame(1), tame(2)
        order = "keep2(" + r.choice(["(x, y) => x - y", "(x, y) => y - x", "(x, y) => (x < y ? -1 : x > y ? 1 : 0)", "(x, y) => Math.floor(x) - Math.floor(y)", "(x, y) => (x % 3) - (y % 3)", "makeDeep(1, -1, 0)", "makeDeep(-2, 2, 0)"]) + ")"
        arr = r.choice(["[1, 2, 3]", "[3, 1, 2, 5, 4]", "[0.5, 1.5]", "[k, k + 1]", "([] as number[])"])
        if b < 0.10: return f"attempt(() => {arr}.map({t1}).join())"
        if b < 0.18: return f"attempt(() => {arr}.map({t2}).join())"
        if b < 0.26: return f"attempt(() => {arr}.reduce({t2}, 0))"
        if b < 0.34: return f"attempt(() => {arr}.sort({order}).join())"
        if b < 0.40: return f"attempt(() => {{ let s = 0; {arr}.forEach(x => {{ s += call1({f1}, x); }}); return s; }})"
        if b < 0.46: return f"attempt(() => {arr}.filter(x => call1({f1}, x) > 1).join())"
        if b < 0.52: return f"attempt(() => Array.from({arr}, {t1}).join())"
        if b < 0.58: return f"attempt(() => {arr}.findIndex(x => call1({f1}, x) > 2))"
        if b < 0.64: return f"attempt(() => new Float64Array({arr}).map({t1}).join())"
        if b < 0.70: return f"attempt(() => {arr}.flatMap(x => [call1({f1}, x), x]).join())"
        if b < 0.76: return f"attempt(() => {arr}.reduceRight({t2}, 1))"
        if b < 0.82: return f"attempt(() => \"a1b22c333\".replace(/[0-9]+/g, t => String(call1({f1}, Number(t)))))"
        if b < 0.88: return f"attempt(() => {{ let s = 0; new Map([[1, 2], [3, 4]]).forEach((v, key) => {{ s += call2({f2}, v, key); }}); return s; }})"
        if b < 0.92: return f"attempt(() => (Acc as any)())"
        if b < 0.96: return f"attempt(() => [...genOne(call1({f1}, 2))].join())"
        return f"attempt(() => {arr}.toSorted({order}).join() + {arr}.some(x => call1({f1}, x) === 2) + {arr}.every(x => call1({f1}, x) < 9))"

    def program(self):
        L, r = self.L, self.r
        L.append(f"// calls-by-value.py seed {self.seed}")
        L.append(HEAD)
        self.callers()
        groups = r.randint(5, 12)
        for g in range(groups):
            L.append(f"function group{g}(k: number, acc: Acc, sub: Sub): void {{")
            for _ in range(r.randint(4, 12)):
                L.append(f"  lines.push({self.one()});")
            L.append("}")
        L.append("async function main(): Promise<void> {")
        L.append("  const acc = new Acc(), sub = new Sub();")
        L.append(f"  for (let k = 0; k < {r.choice([3, 6, 10])}; k++) {{")
        for g in range(groups):
            L.append(f"    group{g}(k, acc, sub); lines.push(\"-- {g} \" + acc.total + \" \" + sub.total + \" \" + moduleCount);")
        L.append("    lines.push(num(await asyncOne(k)) + num(await Promise.resolve(k).then(keep1(" + self.fn(1) + ")).catch(() => -9)));")
        L.append("    if (k % 3 === 0) collect();")
        L.append("  }")
        L.append('  console.log(lines.join("\\n"));')
        L.append("}")
        L.append('main().catch(e => { console.log(lines.join("\\n")); console.log("main failed " + String(e)); });')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
