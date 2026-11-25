#!/usr/bin/env python3
"""results-over-arguments.py <folder>: Writes one file per case. A function takes many parameters, most of them on the stack, and returns a fresh record or list made of those parameters in another order; the caller takes it apart at once.
Results that find no register are stored into words that lie over the incoming arguments. Each prints texts of primitives."""
import os, sys
out = sys.argv[1]
KIND = {"whole-numbers": lambda i: str(i + 1), "fractions": lambda i: str(i) + ".5", "mixed": lambda i: [str(i + 1), str(i) + ".5", "'t%d'" % i, "true"][i % 4]}
P = {}
for p in (12, 20, 28):
    names = ["a%d" % i for i in range(p)]
    for k in (2, 3, 4, 6, 8, 10, 12, 16, 20):
        if k > p: continue
        orders = {"the-first": list(range(k)), "the-last": list(range(p - k, p)), "the-last-reversed": list(range(p - 1, p - k - 1, -1)), "the-last-rotated": list(range(p - k + 1, p)) + [p - k], "the-first-and-the-last-in-turn": [(i // 2 if i % 2 == 0 else p - 1 - i // 2) for i in range(k)], "every-one-the-last": [p - 1] * k}
        for o, order in orders.items():
            for kind, value in KIND.items():
                if kind != "whole-numbers" and (p == 28 or k in (3, 6, 10)): continue
                first = ", ".join(value(i) for i in range(p))
                for shape, (made, taken) in {
                    "a-record": ("{ " + ", ".join("f%d: %s" % (i, names[x]) for i, x in enumerate(order)) + " }", "const { " + ", ".join("f%d" % i for i in range(k)) + " }"),
                    "a-list": ("[" + ", ".join(names[x] for x in order) + "]", "const [" + ", ".join("f%d" % i for i in range(k)) + "]"),
                }.items():
                    P["%s--%s--%s--%d-of-%d.mjs" % (shape, o, kind, k, p)] = "function make(n, %s) { if (n > 0) return make(n - 1, %s); return %s; }\nfunction use(n) { %s = make(n, %s); return [%s].join(); }\nlet said = '';\nfor (let i = 0; i < 3; i++) said += use(i) + '\\n';\nconsole.log(said);\n" % (", ".join(names), ", ".join(names), made, taken, first, ", ".join("f%d" % i for i in range(k)))
for n, t in P.items(): open(os.path.join(out, n), "w").write(t)
open(os.path.join(out, "LIST.txt"), "w").write("\n".join(sorted(P)) + "\n")
print(len(P), "programs")
