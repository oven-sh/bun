#!/usr/bin/env python3
"""tail-call-argument-order.py <folder>: Writes one file per case. A tail call hands its own parameters on in another order: swapped, rotated, reversed, doubled. Most of them are passed on the stack, where the callee's words lie over the caller's.
The order x the kinds of value x who is called x how many parameters. Each prints texts of primitives."""
import os, sys
out = sys.argv[1]
def perms(k):
    r = list(range(k))
    return {
     "the-same-order": r, "the-last-two-swapped": r[:-2] + [r[-1], r[-2]], "the-first-and-the-last-swapped": [r[-1]] + r[1:-1] + [r[0]], "rotated-left": r[1:] + r[:1], "rotated-right": r[-1:] + r[:-1], "reversed": r[::-1],
     "neighbors-swapped": [i ^ 1 if (i ^ 1) < k else i for i in r], "rotated-by-five": r[5:] + r[:5], "the-halves-swapped": r[k // 2:] + r[:k // 2], "every-one-the-last": [k - 1] * k, "every-one-the-first": [0] * k, "each-the-one-behind-it": r[1:] + [r[-1]], "each-the-one-in-front-of-it": [r[0]] + r[:-1],
     "interleaved": [x for p in zip(r[:k // 2], r[k // 2:]) for x in p] + (r[-1:] if k % 2 else []),
    }
KIND = {
 "whole-numbers": ("", lambda i: str(i + 1), ""), "typed-whole-numbers": (": number", lambda i: str(i + 1), ": string"), "typed-fractions": (": number", lambda i: str(i) + ".5", ": string"), "typed-texts": (": string", lambda i: "'t%d'" % i, ": string"),
 "mixed": ("", lambda i: [str(i + 1), str(i) + ".5", "'t%d'" % i, "true", "null", "{ toString() { return 'o%d'; } }" % i][i % 6], ""), "typed-mixed": (None, lambda i: [str(i + 1), str(i) + ".5", "'t%d'" % i, "true"][i % 4], ": string"),
}
MIXED = [": number", ": number", ": string", ": boolean"]
P = {}
for k in (12, 17, 24, 40):
    for p, order in perms(k).items():
        for kind, (ann, value, res) in KIND.items():
            if k in (17, 40) and kind not in ("whole-numbers", "typed-mixed"): continue
            ts = kind.startswith("typed")
            names = ["a%d" % i for i in range(k)]
            params = ", ".join(n + ((MIXED[i % 4] if ann is None else ann) if ts else "") for i, n in enumerate(names))
            if ann is None and any(MIXED[i % 4] != MIXED[o % 4] for i, o in enumerate(order)): continue
            handed = ", ".join(names[o] for o in order)
            nt = ": number" if ts else ""
            end = "[" + ", ".join(names) + "].join()"
            first = ", ".join(value(i) for i in range(k))
            W = {
             "two-functions-in-turn": "function f(n%s, %s)%s { if (n === 0) return %s; return g(n - 1, %s); }\nfunction g(n%s, %s)%s { if (n === 0) return 'g' + %s; return f(n - 1, %s); }\nconst go = f;" % (nt, params, res, end, handed, nt, params, res, end, handed),
             "three-in-a-ring": "function f(n%s, %s)%s { if (n === 0) return %s; return g(n - 1, %s); }\nfunction g(n%s, %s)%s { if (n === 0) return 'g' + %s; return h(n - 1, %s); }\nfunction h(n%s, %s)%s { if (n === 0) return 'h' + %s; return f(n - 1, %s); }\nconst go = f;" % (nt, params, res, end, handed, nt, params, res, end, ", ".join(names), nt, params, res, end, handed),
             "by-value-out-of-a-table": "const table%s = [];\nfunction f(n%s, %s)%s { if (n === 0) return %s; return table[n %% 3](n - 1, %s); }\nfunction g(n%s, %s)%s { if (n === 0) return 'g' + %s; return table[n %% 3](n - 1, %s); }\nfunction h(n%s, %s)%s { if (n === 0) return 'h' + %s; return table[n %% 3](n - 1, %s); }\ntable.push(f, g, h);\nconst go = f;" % (": any[]" if ts else "", nt, params, res, end, handed, nt, params, res, end, handed, nt, params, res, end, handed),
             "methods-in-turn": "class K { f(n%s, %s)%s { if (n === 0) return %s; return this.g(n - 1, %s); }\n  g(n%s, %s)%s { if (n === 0) return 'g' + %s; return this.f(n - 1, %s); } }\nconst k = new K();\nconst go = (...all%s)%s => (k.f as any)(...all);" % (nt, params, res, end, handed, nt, params, res, end, handed, ": any[]" if ts else "", res) if ts else "class K { f(n, %s) { if (n === 0) return %s; return this.g(n - 1, %s); }\n  g(n, %s) { if (n === 0) return 'g' + %s; return this.f(n - 1, %s); } }\nconst k = new K();\nconst go = (...all) => k.f(...all);" % (params, end, handed, params, end, handed),
            }
            for w, code in W.items():
                if k in (17, 40) and w in ("three-in-a-ring", "methods-in-turn"): continue
                P["%s--%s--%s--%d.%s" % (p, kind, w, k, "ts" if ts else "mjs")] = code + "\nlet said = '';\nfor (const steps of [0, 1, 2, 3, 7, 300001]) said += go(steps, %s) + '\\n';\nconsole.log(said);\n" % first
for n, t in P.items(): open(os.path.join(out, n), "w").write(t)
open(os.path.join(out, "LIST.txt"), "w").write("\n".join(sorted(P)) + "\n")
print(len(P), "programs")
