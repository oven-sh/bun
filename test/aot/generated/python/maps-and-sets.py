#!/usr/bin/env python3
"""maps-and-sets.py <seed>: random strict TypeScript programs about Maps and Sets keyed by strings (and by numbers, objects and mixtures): keys that are literals, made of numbers and strings in one
expression (`"k" + i`, template strings, i + "," + j), parts of other strings (slice, substring, split, charAt, match), ropes, 16-bit text, empty, long, text of numbers (-0, 1e21, 0.1 + 0.2, NaN); equal keys made in different ways;
set | get | has | delete | clear | size | iteration while changing; growth from nothing to thousands, deletion and growth again; values that are records, strings, numbers, booleans, null, undefined; collections in between."""
import random, sys, os

HEAD = r'''const G: any = globalThis;
const collect: () => void = typeof G.fullGC === "function" ? G.fullGC : () => G.Bun.gc(true);
const young: () => void = typeof G.edenGC === "function" ? G.edenGC : () => G.Bun.gc(false);
const lines: string[] = [];
let hash = 7;
function mix(s: string): void { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007; }
interface Rec { id: number; name: string }
function any(x: unknown): string { return x === undefined ? "undef" : x === null ? "null" : typeof x === "object" ? "rec" + (x as Rec).id + (x as Rec).name : typeof x === "number" && Object.is(x, -0) ? "-0" : String(x); }
const source = "alpha,beta,gamma,delta,epsilon,zeta,eta,theta,iota,kappa,lambda,mu,10,11,12,a1,a2,a10,k0,k1,k2,k3,k10,k11,0:0,0:1,1:0,1:1,été,世界,";
const parts = source.split(",");
'''


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed
        self.n = 0

    def fresh(self, p="v"):
        self.n += 1
        return f"{p}{self.n}"

    def key(self):
        """A string-valued expression over i, j (integers in scope)."""
        r = self.r
        return r.choice([
            '"k" + i', '"k" + i', '"k" + (i % 7)', '((i * 715827883) | 0) + "," + ((j * 97) | 0)', '(-i) + ":" + (-j)', '((i - 2147483648) | 0) + ""', '"" + ((i + 2147483640) | 0) + "|"', 'i + "" + j', 'i + "," + j + "," + i + "," + j + "," + i',
            '(i * 1000003) + "/" + parts[j % parts.length]', 'parts[i % parts.length] + i + parts[j % parts.length]', '(i % 10) + "" + (i % 100) + "" + (i % 1000)', '"" + (i * 99999)', 'i + ":" + (j - 1) + ":" + ((i * 31) | 0) + ":" + "tail"', '`k${i}`', '`${i}:${j}`', 'i + ":" + j', 'i + "," + j', '"a" + i + "b" + j', 'String(i)', '"" + i', '`${i}`', '"k" + i + ""', '"key number " + i + " of a long enough text to be no short key " + j',
            'parts[i % parts.length]', 'parts[(i * 7 + j) % parts.length]', 'source.slice(i % 40, i % 40 + 1 + j % 5)', 'source.substring(i % 30, i % 30 + 3)', 'source.charAt(i % source.length)', 'source[i % source.length]',
            '"alpha"', '"beta"', '""', '"k1"', '"k10"', '"10"', '"0:1"', '"\\u00e9t\\u00e9"', '"\\u4e16" + "\\u754c"', '"al" + "pha"', '("k" + i).slice(0, 2)', '("xk" + i).slice(1)', '"k" + i / 2', '"k" + (i - 3)', 'String(i / 4)', 'String(-i)', '"k" + (i * 1e21)',
            '(i % 2 ? "k" : "a") + j', '"k".repeat(i % 4) + j', 'String.fromCharCode(97 + i % 26)', 'String.fromCharCode(0x4e00 + i % 5) + j', '(i + j).toString(16)', '[i, j].join("-")', '"K1".toLowerCase()', '" k1 ".trim()', 'JSON.stringify(i)', '"k" + String(i).padStart(3, "0")',
        ])

    def value(self, kind):
        r = self.r
        if kind == "rec": return r.choice(['{ id: i, name: "n" + j }', '{ id: j, name: "" }', "shared"])
        if kind == "str": return r.choice(['"v" + i', '""', '"fixed"', "parts[j % parts.length]", '`${i}/${j}`'])
        if kind == "num": return r.choice(["i", "j", "i + 0.5", "-0", "NaN", "i * j", "1e300"])
        if kind == "bool": return r.choice(["true", "false", "i % 2 === 0"])
        if kind == "opt": return r.choice(['{ id: i, name: "o" }', "undefined", "null"])
        return r.choice(["i", '"s" + i', "null", "undefined", "true", '{ id: i, name: "u" }', "0.5"])

    TYPES = {"rec": "Rec", "str": "string", "num": "number", "bool": "boolean", "opt": "Rec | null | undefined", "mix": "unknown"}

    def ops(self, m, kind, is_set, depth):
        r = self.r
        S = []
        for _ in range(r.randint(1, 5)):
            c = r.random()
            k = self.key()
            if c < 0.30:
                S.append(f"{m}.add({k});" if is_set else f"{m}.set({k}, {self.value(kind)});")
            elif c < 0.42:
                S.append(f"mix(String({m}.has({k})));" if is_set else f"mix(any({m}.get({k})) + {m}.has({k}));")
            elif c < 0.50:
                S.append(f"mix(String({m}.delete({k})) + {m}.size);")
            elif c < 0.53:
                S.append(f"if ((i + j) % {r.choice([37, 101, 211])} === 0) {m}.clear();")
            elif c < 0.57:
                S.append(r.choice(["if (i % 97 === 0) young();", "if (i % 193 === 0) collect();"]))
            elif c < 0.62 and not is_set:
                S.append(f"{{ const key = {k}; const before = {m}.get(key); {m}.set(key, {self.value(kind)}); mix(any(before) + any({m}.get(key))); }}")
            elif c < 0.66 and not is_set and kind == "num":
                S.append(f"{{ const key = {k}; {m}.set(key, ({m}.get(key) ?? 0) + 1); }}")
            elif c < 0.70:
                a, b = self.key(), self.key()
                S.append(f"{{ const a = {a}, b = {b}; if (a === b) mix(\"same\" + {m}.has(a) + {m}.has(b)); }}")
            elif c < 0.76 and depth > 0:
                S += [f"if ({r.choice(['i % 3 === 0', 'j % 2 === 1', m + '.size > 20', m + '.size < 5', m + '.has(' + self.key() + ')'])}) {{"] + self.ops(m, kind, is_set, depth - 1) + ["}"]
            elif c < 0.80:
                S.append(f"if (i % {r.choice([53, 89])} === 0) {{ let s = \"\", n = 0; for (const e of {m}{'' if is_set else '.keys()'}) {{ s += e + \"|\"; if (++n > 12) break; }} mix(s); }}")
            elif c < 0.83:
                S.append(f"if (i % {r.choice([61, 113])} === 0) {{ let n = 0; for (const e of {m}{'' if is_set else '.keys()'}) {{ if (n++ % 2) {m}.delete(e); if (n > 30) break; }} mix(\"cut\" + {m}.size); }}")
            elif c < 0.86 and not is_set:
                S.append(f"if (i % 71 === 0) {{ let s = \"\", n = 0; {m}.forEach((v, key) => {{ if (n++ < 8) s += key + \"=\" + any(v) + \";\"; }}); mix(s); }}")
            else:
                S.append(f"mix(String({m}.size));")
        return S

    def function(self, k):
        r = self.r
        is_set = r.random() < 0.25
        kind = r.choice(["rec", "str", "num", "num", "bool", "opt", "mix"])
        m = "m"
        ty = "Set<string>" if is_set else f"Map<string, {self.TYPES[kind]}>"
        rounds = r.choice([5, 12, 40, 150, 600, 2500])
        inner = r.choice([1, 1, 2, 3])
        L = [f"function f{k}(): void {{", f"  const m: {ty} = new {'Set' if is_set else 'Map'}();"]
        if r.random() < 0.3:
            L.append("  " + ("for (const p of parts) m.add(p);" if is_set else f"for (let i = 0, j = 1; i < parts.length; i++) m.set(parts[i], {self.value(kind)});"))
        L.append(f"  for (let i = 0; i < {rounds}; i++) {{")
        L.append(f"    for (let j = 0; j < {inner}; j++) {{")
        L += ["      " + s for s in self.ops(m, kind, is_set, 2)]
        L.append("    }")
        L.append("  }")
        L.append(('  let s = "", n = 0; for (const e of m' + str('' if is_set else '.entries()') + ') { if (n++ < 25) s += ' + str('e' if is_set else 'e[0] + "=" + any(e[1])') + ' + ";"; else mix(' + str('e' if is_set else 'e[0] + any(e[1])') + '); }'))
        L.append(f"  lines.push(\"f{k} \" + m.size + \" \" + hash + \" \" + s);")
        L.append("}")
        return L

    def other(self, k):
        r = self.r
        c = r.random()
        if c < 0.4:
            return [f"function f{k}(): void {{", "  const m = new Map<number, string>(); const keys = [0, -0, 1, 1.5, NaN, 2147483647, 2147483648, -1, 4294967296, 1e21, 0.1 + 0.2, 0.3, Infinity];",
                    "  for (let i = 0; i < keys.length; i++) m.set(keys[i], \"v\" + i);", "  for (let i = 0; i < 300; i++) m.set(i * 3, \"n\" + i);", "  for (let i = 0; i < 300; i += 2) m.delete(i * 3);",
                    f"  lines.push(\"f{k} \" + m.size + \" \" + keys.map(x => m.get(x)).join() + \" \" + m.get(3) + m.get(6) + m.has(897) + [...m.keys()].slice(0, 20).map(x => Object.is(x, -0) ? \"-0\" : String(x)).join());", "}"]
        if c < 0.7:
            return [f"function f{k}(): void {{", "  const recs: Rec[] = []; for (let i = 0; i < 200; i++) recs.push({ id: i, name: \"r\" + i });", "  const m = new Map<Rec, number>(), s = new Set<Rec>();",
                    "  for (const x of recs) { m.set(x, x.id); if (x.id % 3) s.add(x); }", "  collect();", "  for (let i = 0; i < 200; i += 5) { m.delete(recs[i]); s.delete(recs[i]); }", "  let t = 0; for (const [x, v] of m) t += x.id * 2 + v; for (const x of s) t += x.name.length;",
                    f"  lines.push(\"f{k} \" + m.size + \" \" + s.size + \" \" + t + \" \" + m.has(recs[5]) + m.has(recs[6]) + s.has(recs[6]) + m.has({{ id: 6, name: \"r6\" }}));", "}"]
        return [f"function f{k}(): void {{", "  const m = new Map<unknown, number>(); const keys: unknown[] = [\"1\", 1, true, \"true\", null, \"null\", undefined, \"undefined\", NaN, \"NaN\", 0, \"0\", -0, \"\", 1n, \"1n\", shared, \"k1\", \"k\" + 1];",
                "  for (let i = 0; i < keys.length; i++) m.set(keys[i], i);", f"  lines.push(\"f{k} \" + m.size + \" \" + keys.map(x => m.get(x)).join());", "}"]

    def program(self):
        r = self.r
        L = [f"// maps-and-sets.py seed {self.seed}", HEAD, 'const shared: Rec = { id: -1, name: "shared" };']
        n = r.randint(5, 12)
        for k in range(n):
            L += self.function(k) if r.random() < 0.85 else self.other(k)
        for k in range(n):
            L.append(f"f{k}();")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
