#!/usr/bin/env python3
"""strings.py <seed>: random strict TypeScript programs about strings: slice | substring | substr | at | charAt | charCodeAt | codePointAt | indexOf | lastIndexOf | includes | startsWith | endsWith |
padStart | padEnd | repeat | split | concat with positions that are negative, fractions, NaN, -0, infinite, past the end, in the wrong order, left out; on 8-bit and 16-bit text, ropes, parts of parts, the empty string, one character, long text;
and numbers turned into text: integers an analysis can show, doubles that hold integers, -0, the ends of int32 | uint32 | 2^53, exponents, fractions, by `"" + n`, String(n), template strings, toString(radix), toFixed, join; comparisons and equality of what comes out."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const lines: string[] = [];
function q(x: unknown): string { return typeof x === "string" ? "'" + x + "'" : typeof x === "number" && Object.is(x, -0) ? "-0" : String(x); }
function attempt(f: () => unknown): string { try { return q(f()); } catch (e) { return e instanceof RangeError ? "RangeError" : e instanceof TypeError ? "TypeError" : "thrown " + String(e); } }
const latin = "the quick brown fox jumps over the lazy dog";
const wide = "héllo 世界 😀 end";
const digits = "0123456789";
const list = [3, 1, 4, 1, 5, 9, 2, 6];
'''
POS = ["0", "1", "2", "3", "5", "9", "-1", "-2", "-5", "100", "-100", "0.5", "1.9", "-0.5", "-1.5", "NaN", "-0", "Infinity", "-Infinity", "k", "k + 1", "k - 1", "-k", "k * 2", "k / 2", "s.length", "s.length - 1", "s.length + 1", "s.length >> 1",
       "2147483647", "2147483648", "4294967296", "-2147483648", "list.length", "list[k % 8]", "s.indexOf(\" \")", "s.indexOf(\"zz\")"]
NUMS = ["0", "-0", "1", "-1", "7", "10", "255", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "9007199254740991", "9007199254740992", "1e21", "1e-7", "123456789012345680000", "0.1", "0.1 + 0.2", "1 / 3", "5e-324", "1.7976931348623157e308",
        "NaN", "Infinity", "-Infinity", "1.5", "-1.5", "100.25", "1e6", "1e20", "0.000001", "k", "k + 1", "k * 1000003", "k - 5", "k / 2", "k * 0.5", "k | 0", "list.length", "list[k % 8]", "latin.length", "latin.charCodeAt(k)", "(k * 715827883) | 0", "(k * 715827883) >>> 0", "k * 2147483647", "-k", "k % 3", "Math.floor(k / 3)", "k ** 2", "2 ** (k + 29)"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def text(self):
        r = self.r
        return r.choice(["latin", "latin", "wide", "digits", '""', '"a"', '"ab"', 'latin + wide', 'latin + k', '"x" + latin + "y"', "latin.slice(4, 20)", "latin.slice(4, 20).slice(2, 9)", "wide.slice(1)", "digits.repeat(3)", 'latin.toUpperCase()', "String(k * 12345)", '`${k}:${latin}`',
                         'digits + digits + digits + digits', '[latin, wide].join("|")', 'latin.split(" ")[k % 9]', '"\\ud83d\\ude00\\ud83d"', "wide + wide", 'latin.substring(10)', 'latin.replace("quick", "slow")', '" pad ".trim()'])

    def pos(self):
        return self.r.choice(POS)

    def op(self):
        r = self.r
        a, b = self.pos(), self.pos()
        needle = r.choice(['"o"', '"the"', '""', '" "', '"\\u4e16"', '"zz"', '"g"', "s[1] ?? \"\"", "s.slice(2, 4)", '"x"', '"\\ude00"'])
        und = lambda x: x
        return r.choice([
            f"s.slice({a}, {b})", f"s.slice({a})", f"s.substring({a}, {b})", f"s.substring({a})", f"s.substr({a}, {b})", f"s.at({a})", f"s.charAt({a})", f"s.charCodeAt({a})", f"s.codePointAt({a})", f"s[{a if a != 'undefined' else '0'}]",
            f"s.indexOf({needle}, {a})", f"s.lastIndexOf({needle}, {a})", f"s.includes({needle}, {a})", f"s.startsWith({needle}, {a})", f"s.endsWith({needle}, {a})", f"s.indexOf({needle})", f"s.padStart({a}, {needle})", f"s.padEnd({a}, \"ab\")",
            f"s.slice({a}, {b}).length", f"s.slice({a}, {b}) === s.substring({a}, {b})", f"s.slice({a}).slice({b})", f"s.substring({a}, {b}).charCodeAt(0)", f"s.slice({a}, {b}) + s.slice({b})", f"s.split({needle}, {r.choice(['2', '0', 'undefined', '-1', '1.5'])}).join(\"|\")",
            f"s.slice({a}, {b}) < s.slice({b})", f"s.slice({a}, {b}).toUpperCase()", f"s.slice({a}, {b}).indexOf({needle})", f"s.concat(s.slice({a}, {b}), \"!\")", f"s.slice({a}, {b}).trim()", f"s.localeCompare(s.slice({a}))", f"[...s.slice({a}, {b})].length",
            f"s.slice(0, 3).repeat({r.choice(['0', '1', '2', '-1', '1.5', 'NaN', 'k % 3', 'Infinity'])})", f"s.substring({a}, {b}) === s.substring({b}, {a})", f"s.slice({a}, {b}).at(-1)", f"s.isWellFormed() + s.slice({a}, {b}).isWellFormed().toString()",
        ])

    def number_text(self):
        r = self.r
        n = r.choice(NUMS)
        m = r.choice(NUMS)
        return r.choice([
            f'"" + ({n})', f"String({n})", f"`${{{n}}}`", f'({n}) + ""', f'"n" + ({n}) + "m" + ({m})', f"`${{{n}}}:${{{m}}}`", f"({n}).toString()", f"({n}).toString({r.choice(['2', '8', '16', '36', '10', '3'])})", f"({n}).toFixed({r.choice(['0', '1', '2', '10', '20'])})", f"[{n}, {m}].join()",
            f'("" + ({n})).length', f'"" + ({n}) === String({n})', f'("" + ({n})) < ("" + ({m}))', f"({n}).toPrecision({r.choice(['1', '3', '10', '21'])})", f"({n}).toExponential({r.choice(['0', '2', '10'])})", f"JSON.stringify({n})", f"JSON.stringify([{n}, {m}])", f'latin + ({n})',
            f'({n}) + latin.slice(0, 2)', f'Number("" + ({n}))', f'parseInt("" + ({n}))', f'parseFloat("" + ({n}))', f'("" + ({n})).charCodeAt(0)', f'`${{{n}}}`.padStart(12, "0")', f'(({n}) + ({m})) + ""', f'"" + ({n}) + ({m})', f'String(({n}) | 0)', f'String(({n}) >>> 0)',
            f"({n}).toLocaleString === undefined", f'"k" + ({n}) === "k" + ({m})',
        ])

    def function(self, k):
        r = self.r
        L = [f"function f{k}(k: number): void {{"]
        for _ in range(r.randint(1, 3)):
            L.append(f"  {{ const s: string = {self.text()};")
            for _ in range(r.randint(2, 8)):
                L.append(f"    lines.push(attempt(() => {self.op()}));")
            if r.random() < 0.3:
                i = "i"
                L.append(('    { let t = ""; for (let i = ' + str(r.choice(['0', '-2', '1'])) + '; i < s.length + 2 && i < 30; i++) t += ' + str(r.choice(['s.slice(i, i + 2)', 's.substring(i, i + 1)', 's.charAt(i)', 's.slice(i - 1, i)', 's.slice(-i)', 's.substring(i, 2)', 'String(s.charCodeAt(i))', '(s[i] ?? "_")', 's.slice(i, -i)'])) + ' + "|"; lines.push(t); }'))
            L.append("  }")
        for _ in range(r.randint(2, 10)):
            L.append(f"  lines.push(attempt(() => {self.number_text()}));")
        if r.random() < 0.4:
            L.append(('  { let t = ""; for (let i = ' + str(r.choice(['0', '-3', '2147483640', '4294967290', '-2147483648'])) + ', g = 0; g < 12; i ' + str(r.choice(['++', '+= 3', '*= 2', '+= 0.5', '--'])) + ', g++) t += ' + str(r.choice(['i', '"" + i', 'String(i)', '`<${i}>`', 'i + "," + g', '(i * 2) + ""', '(i / 2) + ""', 'i.toString(16)'])) + ' + ";"; lines.push(t); }'))
        if r.random() < 0.2: L.append("  collect();")
        L.append("}")
        return L

    def program(self):
        r = self.r
        L = [f"// strings.py seed {self.seed}", HEAD]
        n = r.randint(5, 14)
        for k in range(n): L += self.function(k)
        L.append(f"for (let k = 0; k < {r.choice([2, 4, 7])}; k++) {{")
        for k in range(n): L.append(f"  lines.push(\"f{k}\"); f{k}(k);")
        L.append("}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
