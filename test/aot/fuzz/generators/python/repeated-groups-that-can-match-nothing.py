#!/usr/bin/env python3
"""repeated-groups-that-can-match-nothing.py <seed>: random programs about regular expression LITERALS in which a group is repeated and its body has counts or alternatives of its own: (a*)+, (?:a|)*, (a?b?){2,}, ((a*)+)?, (?<=(a*)+b).
Most of the bodies can match the empty string, so that a turn of the group can end where it began. Greedy and lazy counts inside and outside, captures inside the group and references to them, what stands before and behind the group,
flags d g i m s u v y in combinations. Subjects are out of the pattern's own characters, 8-bit and 16-bit, and short, shorter still where a repeated group stands in a repeated group: the number of ways to divide a subject among the turns at least doubles with each character.
Each pattern: exec with every capture and index, test, search, match, replace, split, lastIndex walks."""
import random, sys

HEAD = r'''const lines = [];
function show(m) { return m === null ? "null" : m.index + ":" + Array.from(m).map(x => x === undefined ? "~" : JSON.stringify(x)).join(",") + (m.groups ? JSON.stringify(m.groups) : "") + (m.indices ? JSON.stringify(m.indices) : ""); }
function all(re, subjects) {
  let hash = 7, text = "";
  const mix = s => { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 1000000007; if (text.length < 120) text += s + ";"; };
  for (const s of subjects) {
    re.lastIndex = 0; mix(show(re.exec(s)));
    re.lastIndex = 0; mix(String(re.test(s)) + re.lastIndex);
    mix(String(s.search(re)));
    re.lastIndex = 0; { const m = s.match(re); mix(m === null ? "null" : JSON.stringify(Array.from(m))); }
    re.lastIndex = 0; mix(JSON.stringify(s.replace(re, "<$&|$1>")));
    re.lastIndex = 0; mix(JSON.stringify(s.split(re, 6)));
    if (re.global || re.sticky) { re.lastIndex = 0; let n = 0, m; while ((m = re.exec(s)) !== null && n++ < 12) { mix(show(m) + "@" + re.lastIndex); if (m[0] === "") re.lastIndex++; } }
    for (const at of [1, s.length - 1, s.length]) { re.lastIndex = at; mix(show(re.exec(s)) + "@" + re.lastIndex); }
  }
  return hash + " " + text;
}
'''

ALPHABETS = ["ab", "abc", "aAbB", "01", "0123", "a1 ", "ab\n", "aá", "aš", "乡乢", "a乡b", "áâš", "a\U0001f600", "kKK", "sSſ"]


class Gen:
    def __init__(self, seed):
        self.r = random.Random(seed)
        self.seed = seed

    def char(self, c):
        o = ord(c)
        if c == "\n": return "\\n"
        if o > 0xffff: return "\\u{%x}" % o if self.unicode else "\\u%04x\\u%04x" % (0xd800 + ((o - 0x10000) >> 10), 0xdc00 + ((o - 0x10000) & 0x3ff))
        if o > 126: return "\\u%04x" % o
        return c

    def one(self):
        r = self.r
        c = r.random()
        if c < 0.45: return self.char(r.choice(self.alpha))
        if c < 0.60: return "[" + r.choice(["", "^"]) + "".join(self.char(x) for x in r.sample(self.alpha, r.randint(1, min(2, len(self.alpha))))) + "]"
        if c < 0.92: return r.choice([".", "\\w", "\\W", "\\d", "\\D", "\\s", "\\S", "[^]" if not self.sets else "[\\s\\S]", "[a-z]", "[^0]", "[\\u00e0-\\u4eff]", "[^\\u4e61]"])
        if self.unicode: return r.choice(["\\p{L}", "\\P{L}", "\\p{Lu}", "\\p{Any}", "\\p{Emoji}"])
        return self.char(r.choice(self.alpha))

    def may_be_empty(self):
        return self.r.choice(["*", "*", "?", "*?", "??", "{0,2}", "{0,}", "{0,1}?", "{0,3}?"])

    def any_count(self):
        return self.r.choice(["*", "+", "?", "*?", "+?", "??", "{2}", "{1,2}", "{0,2}", "{2,}", "{1,3}?", ""])

    def open(self):
        r = self.r
        kind = r.choice(["(", "(", "(", "(?:", "(?:", "(?<n%d>"])
        if kind != "(?:": self.groups += 1
        return kind % self.groups if "%d" in kind else kind

    def reference(self):
        return "\\%d" % self.r.randint(1, self.groups) if self.groups else self.one()

    def body(self, depth):
        r = self.r
        c = r.random()
        if c < 0.22: return self.one() + self.may_be_empty()
        if c < 0.34: return self.one() + self.may_be_empty() + self.one() + self.may_be_empty()
        if c < 0.44: return r.choice([self.one() + "|", "|" + self.one(), self.one() + "||" + self.one(), self.one() + self.any_count() + "|" + self.one() + self.may_be_empty(), self.one() + "|" + self.one() + self.one() + "|"])
        if c < 0.52: return r.choice(["\\b", "\\B", "^", "$", "(?=" + self.one() + ")", "(?!" + self.one() + ")", "(?<=" + self.one() + ")", "(?<!" + self.one() + ")"]) + r.choice(["", self.one() + self.may_be_empty()])
        if c < 0.60: return self.one() + self.may_be_empty() + self.reference() + r.choice(["", "*", "?"])
        if c < 0.80 and depth > 0:
            self.nests = True
            return r.choice(["", self.one() + self.any_count()]) + self.group(depth - 1) + r.choice(["", self.one() + self.may_be_empty()])
        if c < 0.90: return self.one() + r.choice(["+", "+?", "{1,2}", "{2,}", ""]) + r.choice(["", self.one() + "?"])
        return self.one() + "|" + self.one() + self.one()

    def group(self, depth):
        r = self.r
        opening = self.open()
        return opening + self.body(depth) + ")" + r.choice(["+", "+", "*", "*", "{1,}", "{2,}", "{0,}", "{1,3}", "{2}", "{3}", "{0,2}", "{2,4}", "+?", "*?", "{1,}?", "{2,}?", "{1,3}?", "?", "??", ""])

    def pattern(self):
        r = self.r
        before = r.choice(["", "", "", "^", "\\b", self.one() + "*", self.one() + "+?", "\\S{1,3}", ".*?", self.one(), "(?:^|" + self.one() + ")", "(?<=" + self.one() + ")"])
        middle = self.group(1)
        if r.random() < 0.25: middle += r.choice(["", self.one()]) + self.group(0)
        if r.random() < 0.08: middle = r.choice(["(?=", "(?!", "(?<=", "(?<!"]) + middle + ")"
        after = r.choice(["", "", "$", self.one(), self.one() + "$", "\\b", "\\B", self.reference(), "(?!" + self.one() + ")", "(?=" + self.one() + ")", "\\S$", self.one() + "+", "|" + self.one()])
        return before + middle + after

    def subject(self):
        r = self.r
        pool = list(self.alpha)
        kind = r.random()
        if kind < 0.3: pool += [chr(ord(c) + 256) for c in self.alpha if ord(c) < 128] + [chr(ord(c) + 0x4e00) for c in self.alpha if ord(c) < 128]
        if kind > 0.8: pool += [" ", "\n", "0", "_"]
        units = "".join(r.choice(pool) for _ in range(r.choice([0, 1, 2, 3, 4, 5, 6, 7]))).encode("utf-16-le")
        return units[:2 * (5 if self.nests else 7)].decode("utf-16-le", "surrogatepass")

    def literal(self, s):
        out = ""
        for ch in s:
            o = ord(ch)
            if ch in "\"\\": out += "\\" + ch
            elif ch == "\n": out += "\\n"
            elif 32 <= o < 127: out += ch
            elif o > 0xffff: out += "\\u{%x}" % o
            else: out += "\\u%04x" % o
        return '"' + out + '"'

    def program(self):
        r = self.r
        L = [f"// repeated-groups-that-can-match-nothing.py seed {self.seed}", HEAD]
        for k in range(r.randint(40, 70)):
            self.alpha = r.choice(ALPHABETS)
            self.groups = 0
            self.nests = False
            flags = "".join(f for f in "dgimsy" if r.random() < 0.16)
            mode = r.random()
            self.unicode = mode < 0.2
            self.sets = mode < 0.07
            if self.unicode: flags += "v" if self.sets else "u"
            body = self.pattern()
            subjects = [self.subject() for _ in range(r.randint(4, 8))]
            L.append(f"try {{ lines.push(\"{k} \" + all(/{body}/{flags}, [{', '.join(self.literal(s) for s in subjects)}])); }} catch (e) {{ lines.push(\"{k} threw \" + e.constructor.name); }}")
        L.append('console.log(lines.join("\\n"));')
        return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.stdout.write(Gen(int(sys.argv[1])).program())
