#!/usr/bin/env python3
"""switch-statements.py <seed>: random strict TypeScript programs about switch statements: labels that are dense, sparse, negative, at the ends of int32 and uint32, in windows of 31 | 32 | 63 | 64 | 65,
many labels that share a few targets, fall-through, default first | in the middle | last | missing, labels that are strings, single characters, enum members, computed; what is switched on: parameters that only ever get integers,
parameters that also get fractions, -0, NaN, infinities, 2^32 + k, char codes, `x | 0`, `x >>> 0`, `x & 63`, lengths, unions with strings, unknown values (strings of digits, booleans, null, undefined, bigints, objects)."""
import random, sys, os

HEAD = r'''const lines: string[] = [];
function num(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
const enum Color { Red, Green, Blue = 5, Far = 70, Negative = -3 }
enum Open { A = 1, B, C, D = 40, E = 41 }
'''
ODD = ["-0", "0.5", "1.5", "-0.5", "NaN", "Infinity", "-Infinity", "4294967296", "4294967297", "4294967301", "-4294967295", "2147483648", "-2147483649", "1e21", "63.999", "1e-320", "9007199254740993"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def labels(self):
        r = self.r
        base = r.choice([0, 0, 1, -5, 10, 48, 65, 97, 100, 1000, -70, 2147483600, -2147483648, 4294967290, 255])
        span = r.choice([3, 8, 16, 31, 32, 33, 63, 64, 65, 66, 100, 128, 300])
        count = min(span, r.choice([2, 3, 5, 8, 12, 20, 40, 64]))
        picked = sorted(r.sample(range(base, base + span), count))
        if r.random() < 0.3: picked = sorted(set(picked + [base, base + span - 1]))
        if r.random() < 0.15: picked.append(r.choice([100000, -100000, 2147483647, -2147483648, 4294967295]))
        return sorted(set(picked))

    def number_switch(self, k):
        r = self.r
        labels = self.labels()
        targets = r.choice([1, 2, 2, 3, 3, 4, 6, len(labels)])
        groups = {}
        for l in labels: groups.setdefault(r.randrange(targets), []).append(l)
        order = list(groups.items())
        r.shuffle(order)
        style = r.choice(["return", "return", "assign", "fall"])
        on = r.choice(["x", "x", "x", "x | 0", "x >>> 0", "x & 63", "x & 255", "x + 1", "x - 1", "Math.floor(x)", "x % 64", "-x", "x * 2", "x >> 1"])
        body = []
        default_at = r.choice([None, 0, len(order) // 2, len(order)])
        for i, (t, ls) in enumerate(order):
            if default_at == i:
                body.append({"return": '    default: return "dflt";', "assign": '    default: s = "dflt"; break;', "fall": '    default: s += "d";'}[style])
            r.shuffle(ls) if r.random() < 0.3 else None
            heads = " ".join(f"case {l}:" for l in ls)
            if style == "return": body.append(f'    {heads} return "t{t}";')
            elif style == "assign": body.append(f'    {heads} s = "t{t}"; break;')
            else: body.append(f'    {heads} s += "{t}";' + (" break;" if r.random() < 0.6 else ""))
        if default_at == len(order):
            body.append({"return": '    default: return "dflt";', "assign": '    default: s = "dflt";', "fall": '    default: s += "d";'}[style])
        L = [f"function f{k}(x: number): string {{", '  let s = "";', f"  switch ({on}) {{"] + body + ["  }", '  return s + "|";', "}"]
        lo, hi = labels[0], labels[-1]
        near = sorted(set(labels[:6] + labels[-6:] + [lo - 1, lo - 2, hi + 1, hi + 2, lo + 31, lo + 32, lo + 63, lo + 64, lo + 65, lo - 64, 0, 1, -1] + r.sample(range(lo - 3, min(hi, lo + 400) + 3), min(12, min(hi, lo + 400) - lo + 5))))
        only_integers = r.random() < 0.5
        values = [str(v) for v in near] + ([] if only_integers else r.sample(ODD, r.randint(3, len(ODD))) + [f"{lo}.5", f"{lo} + 4294967296", f"{hi} - 4294967296", f"{lo} + 1e-9"])
        return L, f"lines.push(\"f{k} \" + [{', '.join(values)}].map(f{k}).join());"

    def text_switch(self, k):
        r = self.r
        pool = r.choice([list("abcdefghijklmnopqrstuvwxyz"), ["if", "in", "do", "for", "let", "new", "var", "case", "else", "this", "void", "with", "break", "const", "while", "return", "typeof", "function"], ["", "a", "aa", "aaa", "ab", "b", "\\u00e9", "0", "1", "10", "-0", "NaN"]])
        labels = r.sample(pool, min(len(pool), r.randint(2, 14)))
        targets = r.choice([1, 2, 3, len(labels)])
        body = [f'    case "{l}": return "t{r.randrange(targets)}";' for l in labels]
        if r.random() < 0.7: body.insert(r.randint(0, len(body)), '    default: return "dflt";')
        on = r.choice(["x", "x", "x[0]", "x.slice(0, 2)", "x + \"\"", "x.toLowerCase()", "x.charAt(0)"])
        L = [f"function f{k}(x: string): string {{", f"  switch ({on}) {{"] + body + ["  }", '  return "none";', "}"]
        values = [f'"{v}"' for v in r.sample(pool, min(len(pool), 10))] + ['""', '"zz"', '"A"', '"a" + "a"', '"retur" + "n"', '"x".repeat(3)', 'String(1)', '"if "']
        return L, f"lines.push(\"f{k} \" + [{', '.join(values)}].map(f{k}).join());"

    def code_switch(self, k):
        r = self.r
        chars = r.sample("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \\t_$.,;:(){}[]+-*/<>=!&|", r.randint(3, 30))
        chars = [c for c in chars if c != "\\"]
        targets = r.choice([1, 2, 3, 4])
        groups = {}
        for c in chars: groups.setdefault(r.randrange(targets), []).append(ord(c))
        body = ["      " + " ".join(f"case {c}:" for c in cs) + f' s += "{t}"; break;' for t, cs in groups.items()]
        if r.random() < 0.8: body.append('      default: s += "-";')
        L = [f"function f{k}(x: string): string {{", '  let s = "";', "  for (let i = 0; i <= x.length; i++) {", "    switch (x.charCodeAt(i)) {"] + body + ["    }", "  }", "  return s;", "}"]
        return L, f"lines.push(\"f{k} \" + [\"the quick (brown) fox_$ = a[0] + b * 2;\", \"\", \"ABC xyz 019\", \"\\u00e9\\u4e16\\t<>\"].map(f{k}).join(\"/\"));"

    def loose_switch(self, k):
        r = self.r
        labels = r.sample(["0", "1", "2", "3", "-1", '"1"', '"a"', "true", "false", "null", "undefined", "NaN", "1.5", "64", "65", '""', "-0"], r.randint(3, 10))
        body = [f'    case {l}: return "t{i}";' for i, l in enumerate(labels)]
        if r.random() < 0.7: body.insert(r.randint(0, len(body)), '    default: return "dflt";')
        L = [f"function f{k}(x: unknown): string {{", "  switch (x) {"] + body + ["  }", '  return "none";', "}"]
        values = ["0", "-0", "1", "2", "3", "-1", '"1"', '"a"', '""', "true", "false", "null", "undefined", "NaN", "1.5", "64", "65", "1n", "{}", "[1]", "4294967297", '"0"', "Symbol.iterator"]
        return L, f"lines.push(\"f{k} \" + [{', '.join(values)}].map(f{k}).join());"

    def enum_switch(self, k):
        r = self.r
        if r.random() < 0.5:
            L = [f"function f{k}(x: Color): string {{", "  switch (x) {", '    case Color.Red: case Color.Blue: return "rb";', '    case Color.Green: return "g";', '    case Color.Far: return "far";', '    case Color.Negative: return "neg";', "  }", '  return "none";', "}"]
            return L, f"lines.push(\"f{k} \" + [Color.Red, Color.Green, Color.Blue, Color.Far, Color.Negative, 6 as Color, 64 as Color, 69 as Color, 71 as Color, -4 as Color].map(f{k}).join());"
        L = [f"function f{k}(x: Open): string {{", "  switch (x) {", '    case Open.A: case Open.C: case Open.E: return "ace";', '    case Open.B: case Open.D: return "bd";', '    default: return "dflt";', "  }", "}"]
        return L, f"lines.push(\"f{k} \" + [Open.A, Open.B, Open.C, Open.D, Open.E, 0 as Open, 42 as Open, 65 as Open, 105 as Open, -1 as Open].map(f{k}).join());"

    def computed_switch(self, k):
        r = self.r
        L = [f"function f{k}(x: number, y: number): string {{", "  switch (x) {", "    case y: return \"y\";", f"    case {r.randint(0, 5)}: return \"c\";", "    case y + 1: return \"y1\";", f"    case {r.randint(6, 9)}: case {r.randint(10, 20)}: return \"cc\";", "    default: return \"dflt\";", "  }", "}"]
        return L, f"lines.push(\"f{k} \" + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, -0, NaN, 2.5].map(v => f{k}(v, 3) + f{k}(v, NaN) + f{k}(v, 2.5)).join());"

    def program(self):
        r = self.r
        L = [f"// switch-statements.py seed {self.seed}", HEAD]
        calls = []
        for k in range(r.randint(8, 20)):
            make = r.choice([self.number_switch] * 7 + [self.text_switch, self.code_switch, self.code_switch, self.loose_switch, self.enum_switch, self.computed_switch])
            text, call = make(k)
            L += text
            calls.append(call)
        L.append("for (let round = 0; round < 2; round++) {")
        L += ["  " + c for c in calls]
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
