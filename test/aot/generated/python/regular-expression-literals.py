#!/usr/bin/env python3
"""regular-expression-literals.py <seed>: random programs about regular expression LITERALS (their code is made at build time): characters, classes, ranges, negations, the dot, anchors, word boundaries, groups (capturing, not,
named), alternatives of like and unlike lengths, greedy and lazy counts, back references, lookahead and lookbehind, flags g i m s u y in combinations; bodies made for the search loops (several alternatives of fixed text, candidates all among digits and
punctuation or all among letters, first characters that dispatch); subjects made from the pattern's own characters: empty, short, long, 16-bit, with characters that are equal to a candidate modulo 128 or 256, matches at the very start and the very end.
Each pattern: exec with every capture and index, test, search, match, matchAll, replace, split, lastIndex walks. JUDGE AGAINST THE INTERPRETER (plain Bun with BUN_JSC_useRegExpJIT=0) OR AN OLDER Bun: plain Bun of the same build has the same code generator."""
import random, sys, os

HEAD = r'''const lines = [];
function show(m) { return m === null ? "null" : m.index + ":" + Array.from(m).map(x => x === undefined ? "~" : JSON.stringify(x)).join(",") + (m.groups ? JSON.stringify(m.groups) : ""); }
function all(re, subjects) {
  let hash = 7, text = "";
  const mix = s => { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007; if (text.length < 160) text += s + ";"; };
  for (const s of subjects) {
    re.lastIndex = 0; mix(show(re.exec(s)));
    re.lastIndex = 0; mix(String(re.test(s)) + re.lastIndex);
    mix(String(s.search(re)));
    re.lastIndex = 0; { const m = s.match(re); mix(m === null ? "null" : JSON.stringify(Array.from(m))); }
    re.lastIndex = 0; mix(JSON.stringify(s.replace(re, "<$&>")));
    re.lastIndex = 0; mix(JSON.stringify(s.split(re, 6)));
    if (re.global || re.sticky) { re.lastIndex = 0; let n = 0, m; while ((m = re.exec(s)) !== null && n++ < 12) { mix(show(m) + "@" + re.lastIndex); if (m[0] === "") re.lastIndex++; } }
    for (const at of [1, 2, s.length - 1, s.length, s.length + 1]) { re.lastIndex = at; mix(show(re.exec(s)) + "@" + re.lastIndex); }
  }
  return hash + " " + text;
}
'''


def repeats_a_group_that_holds_a_count(body):
    """(a*)+, (?:ab?|c)*, ((a{1,3})b){2,}: the ways to divide a subject among the turns of such a group can double with each character."""
    holds_a_count, i, in_class = [], 0, False
    while i < len(body):
        c = body[i]
        if c == "\\": i += 1
        elif in_class: in_class = c != "]"
        elif c == "[": in_class = True
        elif c == "(":
            holds_a_count.append(False)
            if body.startswith("(?", i): i += 1
        elif c == ")":
            if holds_a_count.pop() and (body[i + 1:i + 2] in ("*", "+") or body[i + 1:i + 5] in ("{1,}", "{2,}")): return True
        elif c in "*+?" or (c == "{" and "," in body[i:body.index("}", i)]): holds_a_count = [True] * len(holds_a_count)
        i += 1
    return False


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def alphabet(self):
        r = self.r
        return r.choice(["abc", "abcd", "ab", "xyz", "0123", "01-.", " \\t,;", "aAbB", "abc456", "a.b", "fobar", "_$a1", "<>/=", "()[]", "0123456789", "etaoin", "ABCabc"])

    def esc(self, c):
        return "\\" + c if c in ".*+?()[]{}|^$/\\-" else c

    def chars(self):
        return [c for c in self.alpha.replace("\\t", "\t")]

    def atom(self, depth):
        r = self.r
        cs = self.chars()
        c = r.random()
        one = lambda: {"\t": "\\t"}.get(x := r.choice(cs), self.esc(x))
        if c < 0.34: return one()
        if c < 0.42: return "".join(one() for _ in range(r.randint(2, 4)))
        if c < 0.50: return "[" + r.choice(["", "^"]) + "".join({"\t": "\\t"}.get(x, "\\" + x if x in "]\\^-" else x) for x in r.sample(cs, r.randint(1, min(3, len(cs))))) + "]"
        if c < 0.55: return r.choice(["[a-c]", "[0-9]", "[^a-z]", "[a-zA-Z]", "[b-y]", "[\\w-]", "[\\s\\S]", "[^\\d]", "[0-5a-f]", "[\\u00e0-\\u00ff]", "[^]", "[]" if r.random() < 0.1 else "[a]"])
        if c < 0.62: return r.choice([".", "\\d", "\\w", "\\s", "\\D", "\\W", "\\S"])
        if c < 0.68: return r.choice(["^", "$", "\\b", "\\B"])
        if c < 0.86 and depth > 0:
            kind = r.choice(["(", "(", "(?:", "(?:", "(?=", "(?!", "(?<=", "(?<!"])
            if kind == "(": self.groups += 1
            return kind + self.alternation(depth - 1) + ")"
        if c < 0.90 and self.groups: return "\\" + str(r.randint(1, self.groups))
        if c < 0.93: return r.choice(["\\u00e1", "\\xe1", "\\u4e61", "\\u0161", "\\n", "\\0", "\\u0130", "\\u212a"])
        return one()

    def piece(self, depth):
        r = self.r
        a = self.atom(depth)
        if a in ("^", "$", "\\b", "\\B") or a.startswith(("(?=", "(?!", "(?<")): return a
        c = r.random()
        if c < 0.62: return a
        q = r.choice(["*", "+", "?", "{2}", "{1,2}", "{0,1}", "{2,}", "{0,3}", "{1,}", "{3}"])
        return a + q + ("?" if r.random() < 0.25 else "")

    def sequence(self, depth):
        return "".join(self.piece(depth) for _ in range(self.r.randint(1, 4)))

    def alternation(self, depth):
        r = self.r
        return "|".join(self.sequence(depth) for _ in range(r.choice([1, 1, 1, 2, 2, 3])))

    def words(self):
        """A body for the search loops: alternatives of fixed text."""
        r = self.r
        cs = [c for c in self.chars() if c != "\t"]
        n = r.choice([1, 2, 2, 3, 4, 6])
        length = r.randint(1, 5)
        same = r.random() < 0.6
        ws = ["".join(self.esc(r.choice(cs)) for _ in range(length if same else r.randint(1, 6))) for _ in range(n)]
        body = "|".join(ws)
        return r.choice([body, "(?:" + body + ")", "(" + body + ")", "(?:" + body + ")" + r.choice(["\\b", "$", "x", "\\d", "+"]), r.choice(["\\b", "", "x?"]) + "(?:" + body + ")"])

    def prefixes(self):
        """Alternatives that begin alike, with what follows the group: the ground of groups that are taken for deterministic."""
        r = self.r
        cs = [c for c in self.chars() if c != "\t"]
        w = [r.choice(cs) for _ in range(r.randint(2, 6))]
        alts = set()
        for _ in range(r.randint(2, 5)):
            k = r.randint(0, len(w))
            alts.add("".join(self.esc(c) for c in w[:k]) + ("".join(self.esc(r.choice(cs)) for _ in range(r.randint(0, 2))) if r.random() < 0.4 else ""))
        alts = sorted(alts)
        r.shuffle(alts)
        open_ = r.choice(["(?:", "(?:", "("])
        if open_ == "(": self.groups += 1
        group = open_ + "|".join(alts) + ")" + r.choice(["", "", "", "*", "+", "?", "{2}", "*?", "+?", "{1,2}"])
        after = r.choice(["", "\\b", "$", "\\B", self.esc(r.choice(cs)), self.esc(w[0]), "[" + self.esc(r.choice(cs)).replace("\\.", ".") + "]" if False else self.esc(r.choice(cs)) + "?", "(?=" + self.esc(r.choice(cs)) + ")", "(?!" + self.esc(r.choice(cs)) + ")", "\\d", "\\w", "\\W", ".", "\\1" if self.groups else "", "$|" + self.esc(r.choice(cs))])
        before = r.choice(["", "", "^", "\\b", self.esc(r.choice(cs)) + "*", self.esc(r.choice(cs)) + "+", ".*", ".*?", "(?<=" + self.esc(r.choice(cs)) + ")"])
        return before + group + after

    def loops(self):
        """A run of one character or class, and a continuation that may or may not begin with what the run takes."""
        r = self.r
        cs = [c for c in self.chars() if c != "\t"]
        one = lambda: r.choice([self.esc(r.choice(cs)), self.esc(r.choice(cs)), "[" + "".join("\\" + x if x in "]\\^-" else x for x in r.sample(cs, min(2, len(cs)))) + "]", "\\d", "\\w", ".", "\\s", "[^" + ("\\" + cs[0] if cs[0] in "]\\^-" else cs[0]) + "]", "\\S"])
        parts = []
        for _ in range(r.randint(1, 4)):
            a = one()
            c = r.random()
            if c < 0.55: a += r.choice(["*", "+", "?", "{2,}", "{0,2}", "{1,3}"])
            elif c < 0.65: a += r.choice(["*?", "+?", "??"])
            if r.random() < 0.2:
                self.groups += 1
                a = "(" + a + ")" + r.choice(["", "", "*", "?", "+"])
            elif r.random() < 0.15:
                a = "(?:" + a + one() + r.choice(["", "?"]) + ")" + r.choice(["*", "+", "?", "{2}"])
            parts.append(a)
        tail = r.choice(["", "", "$", "\\b", "\\B", "(?=" + one() + ")", "(?!" + one() + ")", "\\1" if self.groups else "", "|" + one()])
        return r.choice(["", "", "^", "\\b"]) + "".join(parts) + tail

    def subject(self, pattern_words):
        r = self.r
        cs = self.chars()
        aliases = [chr(ord(c) + 128) for c in cs if ord(c) < 128] + [chr(ord(c) + 256) for c in cs] + [chr(ord(c) + 0x4e00) for c in cs if 0x4e00 + ord(c) < 0x9fff]
        kind = r.random()
        n = r.choice([0, 1, 2, 3, 5, 8, 13, 30, 70, 200])
        pool = cs + ([" ", "\n"] if r.random() < 0.3 else [])
        if kind < 0.25: pool = pool + aliases
        if kind > 0.9: pool = aliases or pool
        s = "".join(r.choice(pool) for _ in range(n))
        return s

    def literal(self, s):
        out = ""
        for ch in s:
            o = ord(ch)
            if ch in "\"\\": out += "\\" + ch
            elif ch == "\n": out += "\\n"
            elif ch == "\t": out += "\\t"
            elif 32 <= o < 127: out += ch
            else: out += "\\u%04x" % o
        return '"' + out + '"'

    def program(self):
        r = self.r
        L = [f"// regular-expression-literals.py seed {self.seed}", HEAD]
        for k in range(r.randint(25, 60)):
            self.alpha = self.alphabet()
            self.groups = 0
            family = r.random()
            body = self.words() if family < 0.2 else self.prefixes() if family < 0.5 else self.loops() if family < 0.8 else self.alternation(2)
            if not body or body.startswith(("*", "+", "?")): body = "a" + body
            flags = "".join(f for f in "gimsy" if r.random() < 0.18)
            if r.random() < 0.08 and "\\0" not in body and "[]" not in body: flags += "u"
            subjects = [self.subject(body) for _ in range(r.randint(4, 9))]
            if repeats_a_group_that_holds_a_count(body): subjects = [s[:8] for s in subjects]
            L.append(f"try {{ lines.push(\"{k} \" + all(/{body}/{flags}, [{', '.join(self.literal(s) for s in subjects)}])); }} catch (e) {{ lines.push(\"{k} threw \" + e.constructor.name); }}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
