#!/usr/bin/env python3
"""async-generators.py <seed>: random strict TypeScript programs about ASYNC GENERATORS AND WHO DRIVES THEM: sources, mappers, delegation by yield*, over arrays, sync generators and other async generators, one to four deep;
driven by `for await` (run out, left by break | return | throw), by hand (several requests at once; next | return | throw in any order; after the end), by Promise.all over requests, by another generator;
what is yielded | awaited | returned: plain values, promises fulfilled | rejected | still pending (opened later by gates), thenables that call back at once | late | twice | throw | whose `then` getter throws, promises whose `constructor` getter throws,
promises of a subclass, objects with a `then` that is no function; try | catch | finally with awaits and yields inside; tickers beside them. EVERYTHING THAT HAPPENS IS LOGGED IN ORDER: the log must be plain Bun's."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
if (G.process) G.process.on("unhandledRejection", () => {});
const log: string[] = [];
function say(s: string): void { if (log.length < 4000) log.push(s); }
function q(x: any): string {
  if (x === undefined) return "undef"; if (x === null) return "null"; if (typeof x === "string") return "'" + x + "'"; if (typeof x === "function") return "fn";
  if (x instanceof Error) return "E(" + x.message + ")"; if (x instanceof Promise) return "promise"; if (Array.isArray(x)) return "[" + x.map(q).join() + "]";
  if (typeof x === "object") return "{" + Object.keys(x).map(k => k + ":" + q(x[k])).join() + "}"; return String(x);
}
const gates: (() => void)[] = [];
function gate(v: any, fail = false): Promise<any> { return new Promise((yes, no) => { gates.push(() => { say("gate " + q(v)); fail ? no(new Error("gate " + v)) : yes(v); }); }); }
function broken(id: any): Promise<any> { const p = Promise.resolve(id); Object.defineProperty(p, "constructor", { get() { say("constructor read " + id); throw new Error("broken " + id); } }); return p; }
function watched(id: any): Promise<any> { const p = Promise.resolve(id); Object.defineProperty(p, "constructor", { get() { say("constructor read " + id); return Promise; } }); return p; }
function foreign(id: any): Promise<any> { const p = Promise.resolve(id); Object.defineProperty(p, "constructor", { value: function Other() {} }); return p; }
class Sub<T> extends Promise<T> {}
function thenNow(v: any): any { return { then(yes: (x: any) => void) { say("then now " + q(v)); yes(v); } }; }
function thenLate(v: any): any { return { then(yes: (x: any) => void) { say("then late " + q(v)); Promise.resolve().then(() => yes(v)); } }; }
function thenTwice(v: any): any { return { then(yes: (x: any) => void, no: (x: any) => void) { yes(v); no(new Error("second")); yes("third"); } }; }
function thenThrows(v: any): any { return { then() { say("then throws " + q(v)); throw new Error("then threw " + v); } }; }
function thenRejects(v: any): any { return { then(_: unknown, no: (x: any) => void) { no(new Error("then rejected " + v)); } }; }
function thenGetter(v: any): any { return { get then() { say("then getter " + q(v)); throw new Error("then getter " + v); } }; }
function thenNested(v: any): any { return { then(yes: (x: any) => void) { yes(thenNow(v)); } }; }
function ticker(name: string, n: number): void { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => { say(name + i); }); }
function* syncSource(n: number): Generator<any> { try { for (let i = 0; i < n; i++) yield i; } finally { say("sync source closed"); } }
function settle(tag: string, p: any): void { Promise.resolve(p).then((v: any) => say(tag + " -> " + q(v)), (e: any) => say(tag + " !! " + q(e))); }
function settleRaw(tag: string, p: Promise<any>): void { p.then((v: any) => say(tag + " -> " + q(v)), (e: any) => say(tag + " !! " + q(e))); }
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.gens = []

    def value(self, odd=0.45):
        r = self.r
        k = r.randint(0, 9)
        if r.random() > odd:
            return r.choice([str(k), f"\"s{k}\"", "undefined", "null", f"{{ v: {k} }}", f"[{k}]", f"Promise.resolve({k})", f"Promise.resolve({k})"])
        return r.choice([f"Promise.reject(new Error(\"r{k}\"))", f"gate({k})", f"gate({k}, true)", f"broken({k})", f"watched({k})", f"foreign({k})", f"Sub.resolve({k})", f"thenNow({k})", f"thenLate({k})", f"thenTwice({k})", f"thenThrows({k})", f"thenRejects({k})",
                         f"thenGetter({k})", f"thenNested({k})", f"{{ then: {k} }}", f"Promise.resolve(Promise.resolve({k}))", f"Promise.resolve(thenNow({k}))", f"new Promise(() => {{}})" if r.random() < 0.15 else f"Promise.resolve({k})", f"(async () => {k})()", f"Promise.all([{k}, gate({k})])"])

    def statement(self, name, depth, inner):
        r = self.r
        c = r.random()
        v = self.value()
        if c < 0.26: return [f"say(\"{name} got \" + q(yield {v}));"]
        if c < 0.40: return [f"say(\"{name} awaited \" + q(await {v}));"]
        if c < 0.46: return [f"yield {self.value(0.1)}; yield {self.value(0.1)};"]
        if c < 0.56 and inner: return [f"say(\"{name} star \" + q(yield* {r.choice(inner)}));"]
        if c < 0.62: return [f"yield* [{self.value(0.3)}, {self.value(0.3)}];"]
        if c < 0.66: return [f"yield* syncSource({r.randint(0, 3)});"]
        if c < 0.74 and inner: return [f"for await (const x of {r.choice(inner)}) {{ say(\"{name} item \" + q(x)); {r.choice(['yield x;', 'yield [x];', 'await null;', 'if (x === 1) break;', 'yield x; yield x;', ''])} }}"]
        if c < 0.78: return [f"for await (const x of [{self.value()}, {self.value(0.2)}]) {{ say(\"{name} el \" + q(x)); yield x; }}"]
        if c < 0.88 and depth > 0:
            body = sum((self.statement(name, depth - 1, inner) for _ in range(r.randint(1, 2))), [])
            kind = r.random()
            if kind < 0.4: return ["try {"] + body + [('} catch (e) { say("' + str(name) + ' caught " + q(e)); ' + str(r.choice(['', 'yield "from catch";', 'await null;', 'throw e;', 'return "from catch";'])) + ' }')]
            if kind < 0.8: return ["try {"] + body + [('} finally { say("' + str(name) + ' finally"); ' + str(r.choice(['', 'await null;', 'yield "from finally";', 'await ' + self.value() + ';', ''])) + ' }')]
            return ["try {"] + body + [f"}} catch (e) {{ say(\"{name} caught \" + q(e)); }} finally {{ say(\"{name} finally\"); }}"]
        if c < 0.91:
            if v == "undefined": v = "null"
            return [f"return {v};"] if r.random() < 0.5 else [f"if (k > {r.randint(0, 2)}) return {v};"]
        if c < 0.94: return [f"if (k > {r.randint(0, 2)}) throw new Error(\"{name} threw\");"]
        if c < 0.96: return ["collect();"]
        return [f"say(\"{name} step\");"]

    def generator(self, i):
        r = self.r
        name = f"g{i}"
        inner = [f"g{j}(k)" for j in range(i)][-3:]
        L = [f"async function* {name}(k: number): AsyncGenerator<any, any, any> {{", f"  say(\"{name} begins\");"]
        for _ in range(r.randint(1, 5)):
            L += ["  " + s for s in self.statement(name, 2, inner)]
        L += [f"  say(\"{name} ends\");", "}"]
        return L

    def driver(self, d, n):
        r = self.r
        g = f"g{r.randrange(n)}(k)"
        c = r.random()
        t = f"d{d}"
        if c < 0.30:
            return [('settle("' + str(t) + '", (async () => { let n = 0; for await (const x of ' + str(g) + ') { say("' + str(t) + ' item " + q(x)); ' + str(r.choice(['', 'await null;', 'if (++n > 2) break;', 'if (++n > 1) return "left";', 'if (++n > 2) throw new Error("driver threw");', 'await ' + self.value(0.3) + ';'])) + ' } return "ran out"; })());')]
        if c < 0.62:
            L = [f"{{ const it = {g};"]
            for j in range(r.randint(1, 6)):
                op = r.choice(["next()", "next()", "next()", f"next({self.value(0.2)})", f"return({self.value()})", f"throw(new Error(\"in {j}\"))", "return(undefined)", f"throw({self.value(0.3)})"])
                L.append(f"  settleRaw(\"{t}.{j}\", it.{op});")
            L.append("}")
            return L
        if c < 0.74:
            return [f"settle(\"{t}\", (async () => {{ const it = {g}; const out: string[] = []; for (let j = 0; j < {r.randint(1, 5)}; j++) {{ try {{ out.push(q(await it.{r.choice(['next()', 'next(j)', 'return(j)', 'next()'])})); }} catch (e) {{ out.push(\"caught \" + q(e)); }} }} return out.join(\"|\"); }})());"]
        if c < 0.84:
            return [f"{{ const it = {g}; settle(\"{t}\", Promise.all([it.next(), it.next(), it.{r.choice(['next()', 'return(7)', 'next()'])}]).then(q)); }}"]
        if c < 0.92:
            return [f"{{ const it = {g}; settle(\"{t}\", Promise.allSettled([it.next(), it.throw(new Error(\"early\")), it.next()]).then(rs => rs.map(x => x.status === \"fulfilled\" ? q(x.value) : \"!\" + q(x.reason)).join(\"|\"))); }}"]
        return [f"settle(\"{t}\", (async () => {{ const a = {g}, b = g{r.randrange(n)}(k + 1); const out: string[] = []; for (let j = 0; j < 3; j++) {{ const [x, y] = await Promise.allSettled([a.next(), b.next()]); out.push(x.status + y.status); }} return out.join(); }})());"]

    def program(self):
        r = self.r
        L = [f"// async-generators.py seed {self.seed}", HEAD]
        n = r.randint(2, 6)
        for i in range(n): L += self.generator(i)
        L.append("async function main(): Promise<void> {")
        L.append(f"  for (let k = 0; k < {r.choice([1, 2, 3])}; k++) {{")
        L.append("    say(\"round \" + k);")
        for d in range(r.randint(1, 5)):
            L += ["    " + s for s in self.driver(d, n)]
            if r.random() < 0.4: L.append(f"    ticker(\"t{d}.\", {r.randint(1, 8)});")
        L.append("    for (let turn = 0; turn < 40; turn++) { await null; if (turn % 5 === 4 && gates.length) { gates.shift()!(); } }")
        L.append("    while (gates.length) { gates.shift()!(); for (let turn = 0; turn < 12; turn++) await null; }")
        L.append("    for (let turn = 0; turn < 30; turn++) await null;")
        L.append("  }")
        L.append("}")
        L.append('main().then(() => { console.log(log.join("\\n")); }, e => { console.log(log.join("\\n")); console.log("main failed " + q(e)); });')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
