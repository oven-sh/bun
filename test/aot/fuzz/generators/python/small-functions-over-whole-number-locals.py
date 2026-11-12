#!/usr/bin/env python3
"""Small functions over five local variables that hold whole numbers near the ends of int32: compound assignments,
comparisons that come again as they were, the other way round or negated, swaps, short counted loops, early returns.
No try and no closure; each function is called out of a loop over pairs of arguments. As JavaScript some variables
start as undefined, null, a text or a fraction; as TypeScript every variable is a number.
"""
import random, sys

SEED = int(sys.argv[1])
TYPED = len(sys.argv) > 2 and sys.argv[2] == "ts"
PER = 5
rnd = random.Random(SEED)
V = ["a", "b", "c", "e", "f"]
INTS = ["0", "1", "-1", "2", "3", "7", "31", "32", "255", "65535", "2147483647", "-2147483648", "2147483646", "-2147483647", "1073741824", "100"]
ODD = ["undefined", "null", "0.5", "-0", "NaN", "4294967296", "4294967295", '"3"', '""', "true", "1e21", "-2147483649", "2147483648", "Infinity"]
pick = rnd.choice
if TYPED:
    ODD = ["0.5", "-0", "NaN", "4294967296", "4294967295", "1e21", "-2147483649", "2147483648", "Infinity"]


def const(odd=0.12):
    return pick(ODD) if rnd.random() < odd else pick(INTS)


def atom():
    return pick(V) if rnd.random() < 0.7 else const()


def expr(d=0):
    r = rnd.random()
    if d > 1 or r < 0.25:
        return atom()
    if r < 0.60:
        return f"({expr(d + 1)} {pick(['+', '-', '*', '&', '|', '^', '<<', '>>', '>>>', '%', '/'])} {expr(d + 1)})"
    if r < 0.72:
        return f"(({expr(d + 1)} {pick(['+', '-', '*'])} {expr(d + 1)}) | 0)"
    if r < 0.78:
        return f"{pick(['-', '~', '+'] if TYPED else ['-', '~', '+', '!'])}{atom() if rnd.random() < .8 else '(' + expr(d + 1) + ')'}".replace("--", "- -").replace("++", "+ +")
    if r < 0.86:
        return f"Math.{pick(['imul', 'min', 'max'])}({expr(d + 1)}, {expr(d + 1)})"
    if r < 0.90:
        return f"Math.{pick(['abs', 'floor', 'trunc', 'sign', 'clz32', 'round'])}({expr(d + 1)})"
    if r < 0.97:
        return f"({cond(d + 1)} ? {expr(d + 1)} : {expr(d + 1)})"
    return atom() if TYPED else f"({atom()} ?? {atom()})"


def cond(d=0):
    r = rnd.random()
    if r < 0.62 or d > 1:
        if TYPED:
            # the checker refuses a test for equality that an earlier test has already decided, and any with NaN: constants are only compared by order
            op = pick(['===', '!==', '==', '!=', '<', '<=', '>', '>='])
            return f"{pick(V)} {op} {pick(V) if '=' in op and op not in ('<=', '>=') else atom()}"
        return f"{atom()} {pick(['===', '!==', '==', '!=', '<', '<=', '>', '>='])} {atom()}"
    if r < 0.70:
        return f"!({cond(d + 1)})"
    if r < 0.82:
        return f"{cond(d + 1)} {pick(['&&', '||'])} {cond(d + 1)}"
    if r < 0.90:
        return pick(V)
    if r < 0.95:
        return f"Object.is({atom()}, {atom()})"
    return pick(V) if TYPED else f'typeof {pick(V)} === "{pick(["number", "undefined", "string"])}"'


class Fn:
    def __init__(self):
        self.n = 0
        self.conds = []

    def a_cond(self):
        # a test seen before comes again, as it was, the other way round, or negated
        if self.conds and rnd.random() < 0.35:
            c = pick(self.conds)
            parts = c.split(" ")
            flip = {"===": "===", "!==": "!==", "==": "==", "!=": "!=", "<": ">", "<=": ">=", ">": "<", ">=": "<="}
            if len(parts) == 3 and parts[1] in flip and "(" not in c and rnd.random() < 0.6:
                return f"{parts[2]} {flip[parts[1]]} {parts[0]}"
            return c if rnd.random() < 0.6 else f"!({c})"
        c = cond()
        self.conds.append(c)
        return c

    def stmt(self, d, loop):
        r = rnd.random()
        v = pick(V)
        if r < 0.20:
            return [f"{v} = {expr()};"]
        if r < 0.36:
            return [f"{v} {pick(['+=', '-=', '*=', '^=', '|=', '&=', '<<=', '>>=', '>>>=', '%='])} {expr(1)};"]
        if r < 0.46:
            return [pick([f"{v}++;", f"{v}--;", f"++{v};", f"--{v};"])]
        if r < 0.52:
            w = pick(V)
            return [pick([f"[{v}, {w}] = [{w}, {v}];", f"{{ const t = {v}; {v} = {w}; {w} = t; }}", f"{v} = {w};", f"[{v}, {w}, {pick(V)}] = [{w}, {pick(V)}, {v}];"])]
        if d >= 2:
            return [f"{v} = {expr()};"]
        if r < 0.72:
            out = [f"if ({self.a_cond()}) {{"] + self.block(d + 1, loop) + ["}"]
            if rnd.random() < 0.55:
                out[-1] = "} else {"
                out += self.block(d + 1, loop) + ["}"]
            return out
        if r < 0.82:
            self.n += 1
            i = f"i{self.n}"
            bound = pick(["2", "3", "4", "5", f"({pick(V)} & 3)", f"({pick(V)} & 7)", "n"])
            head = pick([f"for (let {i} = 0; {i} < {bound}; {i}++) {{", f"for (let {i} = {bound}; {i} > 0; {i}--) {{", f"for (let {i} = 0; {i} !== 3; {i}++) {{", f"for (let {i} = 0; {i} <= 2; {i} += 1) {{"])
            return [head] + self.block(d + 1, True) + ["}"]
        if r < 0.89:
            self.n += 1
            g = f"g{self.n}"
            if rnd.random() < 0.6:
                return [f"let {g} = 0;", f"while (({self.a_cond()}) && {g}++ < {pick('234')}) {{"] + self.block(d + 1, True) + ["}"]
            return [f"let {g} = 0;", "do {"] + self.block(d + 1, True) + [f"}} while (({self.a_cond()}) && ++{g} < {pick('234')});"]
        if r < 0.93:
            return [f"switch ({pick(V)} & 3) {{", "case 0:"] + self.block(d + 1, loop, 1) + pick([["break;"], []]) + ["case 1:"] + self.block(d + 1, loop, 1) + ["break;", "default:"] + self.block(d + 1, loop, 1) + ["}"]
        if r < 0.96 and loop:
            return [f"if ({self.a_cond()}) {pick(['break', 'continue'])};"]
        if r < 0.98:
            return [f"if ({self.a_cond()}) return [a, b, c, e, f, \"early\"].join();"]
        return [f"{v} = {expr()};"]

    def block(self, d, loop, n=None):
        out = []
        for _ in range(n or rnd.choice((1, 1, 2, 2, 3))):
            s = self.stmt(d, loop)
            # a `continue` in a while loop whose guard is in its test is safe; a switch inside a loop takes `break` for itself, which is fine too
            out += ["  " + l for l in s]
        return out


PAIRS = ["0, 1", "100, 3", "8, 8", "5, -2147483648", "-2147483651, 0", "2147483644, 2147483647", "-1, -1", "1, 0", "3, 2", "2147483647, 1", "-2147483648, -1", "7, 31", "65536, 65536", "0, 0"]
MIXED = ["undefined, 1", '"3", 3', "0.5, 2", "null, 0", "-0, 0", "NaN, 1", "true, 1", "4294967296, 1"]


def function(name):
    f = Fn()
    init = ["a = x", "b = y", f"c = {const()}", f"e = {const()}", f"f = {pick(['(a + 3) | 0', 'a + b', const(), 'a * 2' if TYPED else 'undefined', 'a', 'b - 1', '(a ^ b)'])}"]
    body = []
    for _ in range(rnd.choice((2, 3, 3, 4, 5, 6))):
        body += ["  " + l for l in f.stmt(0, False)]
    if TYPED:
        init = [i.replace(" =", ": number =", 1) for i in init]
    text = [f"function {name}(x: number, y: number, n: number): string {{" if TYPED else f"function {name}(x, y, n) {{", "  let " + ", ".join(init) + ";"] + body + ["  return [a, b, c, e, f].join();", "}"]
    pairs = rnd.sample(PAIRS, 4) + (rnd.sample(MIXED, 2) if rnd.random() < 0.3 and not TYPED else [])
    how = rnd.random()
    lists = ", ".join(f"[{p}]" for p in pairs)
    if how < 0.7:
        text.append(f'for (const [x, y] of [{lists}]) console.log("{name}", {name}(x, y, 3));')
    elif how < 0.85:
        text.append(f'for (const each of [{name}]) for (const [x, y] of [{lists}]) console.log("{name}", each(x, y, 3));')
    else:
        text += [f'console.log("{name}", {name}({p}, 3));' for p in pairs[:3]]
    return "\n".join(text) + "\n"


sys.stdout.write("".join(function(f"k{i}") for i in range(PER)))
