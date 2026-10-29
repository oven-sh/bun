#!/usr/bin/env python3
"""maybe-integer-numbers.py <seed>: random strict TypeScript programs about numbers that an analysis may show to be integers: counters, lengths, sums held against
bounds, steps up and down, products, remainders, shifts, negation, Math.floor | min | max | abs, char codes, indexOf: with literals at the ends of int32, uint32 and 2^53, so that a variable
"shown" to fit leaves its range, becomes -0, a fraction, NaN or Infinity. Every variable is printed exactly (-0 too) and used as an index of arrays and strings."""
import random, sys, os

HEAD = r'''const lines: string[] = [];
function num(x: number | undefined): string { return x === undefined ? "undef" : Object.is(x, -0) ? "-0" : String(x); }
const small: number[] = [10, 11, 12, 13, 14, 15, 16, 17];
const floats: number[] = [0.5, 1.5, 2.5, 3.5];
const text = "the quick brown fox jumps over the lazy dog";
const empty: number[] = [];
const holder = { n: 5, list: [1, 2, 3, 4, 5, 6] };
'''
LITS = ["0", "1", "2", "3", "5", "7", "8", "31", "100", "255", "65535", "65536", "1073741823", "1073741824", "2147483646", "2147483647", "2147483648", "4294967295", "4294967296", "-1", "-2", "-7",
        "-2147483647", "-2147483648", "-2147483649", "9007199254740991", "9007199254740992", "-9007199254740991", "1000000", "46341", "46340"]
SMALL = ["0", "1", "2", "3", "4", "5", "7", "8"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    def source(self, env):
        r = self.r
        c = r.random()
        if c < 0.30: return r.choice(LITS)
        if c < 0.45: return r.choice(SMALL)
        if c < 0.60 and env: return r.choice(env)
        return r.choice(["small.length", "text.length", "floats.length", "empty.length", "holder.n", "holder.list.length", "text.charCodeAt(2)", 'text.indexOf("q")', 'text.indexOf("zz")', "p", "q", "(p | 0)", "(q >>> 0)", "small[1]", "list.length", "list.length - 1"])

    def expr(self, env, depth=2):
        r = self.r
        if depth == 0 or r.random() < 0.3: return self.source(env)
        a, b = self.expr(env, depth - 1), self.expr(env, depth - 1)
        c = r.random()
        if c < 0.22: return f"({a} + {b})"
        if c < 0.38: return f"({a} - {b})"
        if c < 0.48: return f"({a} * {b})"
        if c < 0.54: return f"({a} % {b})"
        if c < 0.58: return f"(({a} / {b}) | 0)"
        if c < 0.62: return f"Math.floor({a} / {b})"
        if c < 0.66: return f"({a} >> {r.choice(['1', '2', '31', '32', b])})"
        if c < 0.70: return f"({a} >>> {r.choice(['0', '1', '31'])})"
        if c < 0.73: return f"({a} << {r.choice(['1', '4', '30', '31'])})"
        if c < 0.76: return f"({a} & {b})"
        if c < 0.79: return f"({a} | {b})"
        if c < 0.82: return f"(- {a})"
        if c < 0.86: return f"Math.min({a}, {b})"
        if c < 0.90: return f"Math.max({a}, {b})"
        if c < 0.93: return f"Math.abs({a})"
        if c < 0.95: return f"Math.imul({a}, {b})"
        if c < 0.97: return f"Math.trunc({a} / {b})"
        return f"({a} / {b})"

    def test(self, env):
        r = self.r
        a, b = self.expr(env, 1), self.expr(env, 1)
        c = r.random()
        op = r.choice(["<", "<=", ">", ">=", "===", "!=="])
        if c < 0.3 and len(env) >= 2:
            x, y = r.sample(env, 2)
            return r.choice([f"{x} + {y} {op} {b}", f"{b} {op} {x} + {y}", f"{x} - {y} {op} {b}", f"{x} + {r.choice(SMALL)} {op} {b}"])
        return f"{a} {op} {b}"

    def use(self, env):
        r = self.r
        v = r.choice(env)
        w = r.choice(env)
        return r.choice([
            f"lines.push(num({v}));", f"lines.push(num(small[{v}]));", f"lines.push(num(list[{v}]));", f"lines.push(num(list[{v} + {w}]));", f"lines.push(String(text[{v}]));", f"lines.push(num(text.charCodeAt({v})));",
            f"lines.push(num(floats[{v} - {w}]));", f"lines.push(num({v} + {w}) + \" \" + num({v} * {w}) + \" \" + num({v} - {w}));", f"lines.push(num({v} / {w}) + \" \" + num({v} % {w}));", f"lines.push(String({v} < {w}) + ({v} === {w}) + ({v} <= {w}));",
            f"lines.push(num({v} | 0) + \" \" + num({v} >>> 0) + \" \" + num(~{v}));", f"lines.push(text.slice({v}, {w}));", f"lines.push(String({v}).length + \":\" + {v}.toString(16));", f"if ({v} >= 0 && {v} < list.length) list[{v}] = {w};",
            f"lines.push(num(1 / {v}));", f"lines.push(String(Number.isInteger({v})) + Number.isSafeInteger({v}) + ({v} === ({v} | 0)));",
        ])

    def block(self, env, depth):
        r = self.r
        S = []
        env = list(env)
        for _ in range(r.randint(1, 5)):
            c = r.random()
            if c < 0.18 or not env:
                v = self.fresh()
                S.append(f"let {v} = {self.expr(env)};")
                env.append(v)
            elif c < 0.42:
                v = r.choice(env)
                S.append(r.choice([f"{v} = {self.expr(env)};", f"{v} += {self.expr(env, 1)};", f"{v} -= {self.expr(env, 1)};", f"{v}++;", f"{v}--;", f"{v} *= {self.source(env)};", f"{v} = - {v};", f"{v} = {v} + 1;", f"{v} %= {self.source(env)};", f"{v} >>= 1;", f"{v} = {v} * 2 + 1;"]))
            elif c < 0.62:
                S.append(self.use(env))
            elif c < 0.72 and depth > 0:
                i = self.fresh("i")
                g = self.fresh("g")
                form = r.random()
                if form < 0.45:
                    head = f"for (let {i} = {self.source(env)}, {g} = 0; {i} {r.choice(['<', '<=', '!=='])} {self.expr(env, 1)} && {g} < {r.randint(3, 12)}; {i} {r.choice(['++', '+= 1', '+= 2', '+= ' + self.source(env), '*= 2'])}, {g}++) {{"
                elif form < 0.75:
                    head = f"for (let {i} = {self.expr(env, 1)}, {g} = 0; {i} {r.choice(['>', '>=', '!=='])} {self.source(env)} && {g} < {r.randint(3, 12)}; {i} {r.choice(['--', '-= 1', '-= 2', '-= ' + self.source(env), '>>= 1'])}, {g}++) {{"
                else:
                    head = f"for (let {i} = 0, {g} = 0; {i} < list.length && {g} < 12; {i}++, {g}++) {{"
                S += [head] + self.block(env + [i], depth - 1) + ["}"]
            elif c < 0.80 and depth > 0 and env:
                i, cnt, g = r.choice(env), self.fresh("c"), self.fresh("g")
                S += [f"{{ let {cnt} = {r.choice(['1', '0', self.source(env)])}, {g} = 0; while ({i} + {cnt} < {self.source(env)} && {g}++ < 9) {cnt}{r.choice(['++', ' += 2', ' *= 2', ' += ' + i])};"] + self.block(env + [cnt], depth - 1) + [f"{i} += {cnt}; }}"]
            elif c < 0.92 and depth > 0:
                S += [f"if ({self.test(env)}) {{"] + self.block(env, depth - 1) + (["} else {"] + self.block(env, depth - 1) if r.random() < 0.5 else []) + ["}"]
            else:
                S.append(self.use(env))
        return S

    def program(self):
        r = self.r
        L = [f"// maybe-integer-numbers.py seed {self.seed}", HEAD]
        n = r.randint(4, 10)
        for k in range(n):
            L.append(f"function f{k}(p: number, q: number, list: number[]): void {{")
            L.extend("  " + s for s in self.block([], 3))
            L.append("}")
        pairs = [(r.choice(LITS + SMALL), r.choice(LITS + SMALL)) for _ in range(r.randint(2, 5))]
        for k in range(n):
            same = r.random() < 0.5
            for (p, q) in (pairs[:1] if same else pairs):
                L.append(f"lines.push(\"f{k} {p} {q}\"); f{k}({p}, {q}, [1, 2, 3, 4, 5, 6, 7, 8, 9]);")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
