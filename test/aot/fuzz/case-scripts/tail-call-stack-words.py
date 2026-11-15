#!/usr/bin/env python3
"""tail-call-stack-words.py <folder>: Writes one file per case. A call in tail position passes more arguments on the stack than its caller was given: every way of
calling, 9 to 40 arguments, and several ways into the caller. The function above holds twelve values across the call and prints them behind it.
"""
import os, re, sys
out = sys.argv[1]
H = '''const text = known => process.argv[8] ?? known;
const launder = new Function("value", text("return value"));
const N = Number(process.argv[9] ?? 20000);
let said = "";
function make(n) { return { v: n }; }
'''
def args(k, first="n - 1"): return ", ".join([first] + [str(i) for i in range(1, k)])
def params(k): return ", ".join(["n"] + ["p%d" % i for i in range(1, k)])
TOP = '''function top(enter) {
  const a = make(1), b = make(2), c = make(3), d = make(4), e = 5.5, f = 6.5, g = "seven", h = make(8), i = 9, j = make(10), k = 11.5, l = make(12);
  const r = enter();
  return r + "|" + a.v + b.v + c.v + d.v + e + f + g + h.v + i + j.v + k + l.v;
}
'''
ENTER = {
 "directly": "top(() => few(N))",
 "through-unknown-code": "top(() => launder(few)(N))",
 "out-of-a-callback": "top(() => [N].map(x => few(x))[0])",
 "out-of-text": "top(() => new Function('f', 'n', text('return f(n)'))(few, N))",
 "by-call": "top(() => few.call(null, N))",
}
P = {}
for k in (9, 10, 13, 20, 40):
    last = "p%d" % (k - 1)
    LOTS = "function lots(%s) { if (n <= 0) return p1 + %s; return few(n - 1); }\n" % (params(k), last)
    W = {
     "a-parameter": ("let way = lots;\n", "function few(n) { if (n <= 0) return -1; const f = way; return f(%s); }" % args(k)),
     "out-of-a-list": ("const table = [lots, lots];\n", "function few(n) { if (n <= 0) return -1; return table[n & 1](%s); }" % args(k)),
     "a-laundered-function": ("const hidden = launder(lots);\n", "function few(n) { if (n <= 0) return -1; return hidden(%s); }" % args(k)),
     "a-method-of-an-unknown-object": ("const holder = launder({ lots });\n", "function few(n) { if (n <= 0) return -1; return holder.lots(%s); }" % args(k)),
     "a-computed-method": ("const holder = launder({ lots }), key = launder('lots');\n", "function few(n) { if (n <= 0) return -1; return holder[key](%s); }" % args(k)),
     "an-optional-call": ("const hidden = launder(lots);\n", "function few(n) { if (n <= 0) return -1; return hidden?.(%s); }" % args(k)),
     "by-call": ("", "function few(n) { if (n <= 0) return -1; return lots.call(null, %s); }" % args(k)),
     "by-apply": ("", "function few(n) { if (n <= 0) return -1; return lots.apply(null, [%s]); }" % args(k)),
     "by-reflect-apply": ("", "function few(n) { if (n <= 0) return -1; return Reflect.apply(lots, null, [%s]); }" % args(k)),
     "by-spread": ("const rest = [%s];\n" % ", ".join(str(i) for i in range(1, k)), "function few(n) { if (n <= 0) return -1; return lots(n - 1, ...rest); }"),
     "by-spread-of-an-unknown-function": ("const rest = [%s], hidden = launder(lots);\n" % ", ".join(str(i) for i in range(1, k)), "function few(n) { if (n <= 0) return -1; return hidden(n - 1, ...rest); }"),
     "a-bound-function": ("const bound = lots.bind(null);\n", "function few(n) { if (n <= 0) return -1; return bound(%s); }" % args(k)),
     "a-tagged-template": ("function tag(strings, %s) { if (n <= 0) return p1 + %s; return few(n - 1); }\n" % (params(k), last), "function few(n) { if (n <= 0) return -1; return tag`" + "".join("${%s}" % x for x in args(k).split(", ")) + "`; }"),
     "a-method-of-one-of-six-classes": ("".join("class K%d { lots(%s) { if (n <= 0) return p1 + %s + %d; return few(n - 1); } }\n" % (c, params(k), last, 0) for c in range(6)) + "const kinds = [new K0(), new K1(), new K2(), new K3(), new K4(), new K5()];\n", "function few(n) { if (n <= 0) return -1; return kinds[n %% 6].lots(%s); }" % args(k)),
     "a-method-of-super": ("class Base { lots(%s) { if (n <= 0) return p1 + %s; return it.few(n - 1); } }\nclass Derived extends Base { few(n) { if (n <= 0) return -1; return super.lots(%s); } }\nconst it = new Derived();\n" % (params(k), last, args(k)), "function few(n) { return it.few(n); }"),
     "a-function-made-from-text": ("const made = new Function(%s, text('\"use strict\"; if (n <= 0) return p1 + %s; return back(n - 1);'));\n" % (", ".join("'%s'" % x for x in (params(k) + ", back").split(", ")), last), "function few(n) { if (n <= 0) return -1; return made(%s, few); }" % args(k)),
     "a-direct-call": ("", "function few(n) { if (n <= 0) return -1; return lots(%s); }" % args(k)),
    }
    for w, (setup, few) in W.items():
        for e, enter in ENTER.items():
            if k not in (13,) and e not in ("directly", "through-unknown-code"): continue
            body = H + (LOTS if re.search(r"\blots\b", setup + few) and "class " not in setup else "") + setup + few + "\n" + TOP + "said += %s;\nsaid += ' ' + %s;\nconsole.log(said);\n" % (enter, enter)
            P["s%02d-%s--%s.mjs" % (k, w, e)] = body
for n, x in P.items(): open(os.path.join(out, n), "w").write(x)
print(len(P), "programs")
