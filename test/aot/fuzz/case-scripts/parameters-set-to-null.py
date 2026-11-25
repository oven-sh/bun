#!/usr/bin/env python3
"""parameters-set-to-null.py <folder>: Writes one file per case. A callee sets its parameter to null and a collection runs; the caller goes on using what it passed.
Suspended functions, arguments on the stack, fewer and more arguments than parameters, calls in tail position.
"""
import os, sys
out = sys.argv[1]
H = '''let said = "";
function make(n) { return { v: n, list: [n, n + 1], text: "t" + n }; }
function churn() { for (let i = 0; i < 2000; i++) make(i); Bun.gc(true); }
function look(o) { said += o.v + ":" + o.list[1] + ":" + o.text + " "; }
'''
P = {}
def p(n, b, ext="mjs"): P[n + "." + ext] = H + b + "\nconsole.log(said);\n"
W = ", ".join("p%d" % i for i in range(12))
p("l01-used-behind-the-call", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return 1; }\nfunction run(k) { const o = make(k); drop(o, 2); look(o); }\nfor (let k = 0; k < 3; k++) run(k);")
p("l02-on-the-stack", "function drop(%s, x, n) { if (n > 0) return drop(%s, x, n - 1); x = null; churn(); return p0 + p11; }\nfunction run(k) { const o = make(k); drop(%s, o, 2); look(o); }\nfor (let k = 0; k < 3; k++) run(k);" % (W, W, ", ".join(str(i) for i in range(12))))
p("l03-in-a-loop", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return 1; }\nfunction run() { const o = make(7); for (let i = 0; i < 3; i++) { drop(o, 1); look(o); } }\nrun();")
p("l04-passed-twice", "function drop(x, y, n) { if (n > 0) return drop(x, y, n - 1); x = null; churn(); return y.v; }\nfunction run(k) { const o = make(k); said += drop(o, o, 2) + ' '; said += drop(make(k + 10), make(k + 20), 2) + ' '; look(o); }\nrun(1);")
p("l05-in-the-place-of-a-return", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return 1; }\nfunction hand(x) { return drop(x, 2); }\nfunction run(k) { const o = make(k); hand(o); look(o); }\nrun(1);")
p("l06-handed-on", "function last(x, n) { if (n > 0) return last(x, n - 1); x = null; churn(); return 1; }\nfunction middle(x, n) { const r = last(x, n); churn(); return r + 1; }\nfunction run(k) { const o = make(k); said += middle(o, 2) + ' '; look(o); }\nrun(1);")
p("l07-handed-on-and-read-behind", "function last(x, n) { if (n > 0) return last(x, n - 1); x = null; churn(); return 1; }\nfunction middle(x, n) { const r = last(x, n); churn(); return r + x.v; }\nfunction run(k) { said += middle(make(k), 2) + ' '; }\nrun(5);")
p("l08-fewer-arguments", "function drop(n, x, y) { if (n > 0) return drop(n - 1, x, y); x = null; y = null; churn(); return 1; }\nfunction run(k) { const o = make(k); drop(2, o); drop(2); drop(2, o, o); look(o); }\nrun(1);")
p("l09-more-arguments", "function drop(n, x) { if (n > 0) return drop(n - 1, x, x, x); x = null; churn(); return arguments.length; }\nfunction run(k) { const o = make(k); said += drop(2, o, o, o) + ' '; look(o); }\nrun(1);")
p("l10-async-thirteen", "async function later(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) { await 0; v11 = null; churn(); await 0; return a + b + v9.v; }\nconst kept = []; for (let i = 0; i < 8; i++) kept.push(make(i));\nconst all = await Promise.all(kept.map((o, i) => later(i, 1, o, o, o, o, o, o, o, o, o, o, o)));\nfor (let i = 0; i < 8; i++) said += all[i] + ' '; for (const o of kept) look(o);")
p("l11-generator-thirteen", "function* each(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) { yield a; v11 = null; churn(); yield b; yield v9.v; }\nfunction run(k) { const o = make(k); let sum = 0; for (const v of each(1, 2, o, o, o, o, o, o, o, o, o, o, o)) { sum += v; churn(); } said += sum + ' '; look(o); }\nrun(4);")
p("l12-generators-taken-in-turn", "function* each(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) { yield a; v11 = null; yield b; v0 = null; yield v9.v; }\nconst o = make(3), g = each(1, 2, o, o, o, o, o, o, o, o, o, o, o), h = each(5, 6, o, o, o, o, o, o, o, o, o, o, o);\nfunction deep(it, n, x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, xa, xb) { return n > 0 ? deep(it, n - 1, x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, xa, xb) + xb : it.next().value; }\nfor (let i = 0; i < 3; i++) said += deep(g, i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) + ':' + deep(h, 2 - i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) + ' ';\nlook(o);")
p("l13-sloppy-arguments", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return String(arguments[0]); }\nfunction run(k) { const o = make(k); said += drop(o, 2) + ' '; look(o); }\nrun(1);", "cjs")
p("l14-strict-arguments", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return arguments[0].v; }\nfunction run(k) { const o = make(k); said += drop(o, 2) + ' '; look(o); }\nrun(1);")
p("l15-thrown-behind", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); throw new Error('e'); }\nfunction run(k) { const o = make(k); try { drop(o, 2); } catch (e) { said += e.message + ' '; } look(o); }\nrun(1);")
p("l16-walk-of-a-chain", "let root = null; for (let i = 0; i < 300; i++) root = { next: root, v: i };\nfunction walk(node, sum) { if (!node) return sum; const next = node.next, v = node.v; node = null; if (v % 100 === 0) churn(); return walk(next, sum + v); }\nsaid += walk(root, 0) + ' ' + walk(root, 1) + ' ' + root.v;")
p("l17-captured-by-a-default", "function drop(x, get = () => x, n = 2) { if (n > 0) return drop(x, get, n - 1); x = null; churn(); return get().v; }\nfunction run(k) { const o = make(k); said += drop(o) + ' '; look(o); }\nrun(1);")
p("l18-undefined-in-place-of-null", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = undefined; churn(); return 1; }\nfunction other(x, n) { if (n > 0) return other(x, n - 1); x = 0; churn(); return 1; }\nfunction run(k) { const o = make(k); drop(o, 2); other(o, 2); look(o); }\nrun(1);")
p("l19-method", "class Sink { drop(x, n) { if (n > 0) return this.drop(x, n - 1); x = null; churn(); return 1; } }\nfunction run(k) { const o = make(k), s = new Sink(); s.drop(o, 2); look(o); }\nrun(1);")
p("l20-only-name-is-a-member", "function drop(x, n) { if (n > 0) return drop(x, n - 1); x = null; churn(); return 1; }\nfunction run(k) { const holder = { o: make(k) }; drop(holder.o, 2); look(holder.o); }\nrun(1);")
p("l21-value-of-an-expression", "function drop(x, n) { if (n > 0) return drop(x, n - 1); const v = x.v; x = null; churn(); return v; }\nfunction run(k) { said += drop(make(k), 2) + drop(make(k + 1), 0) + ' '; }\nrun(1);")
p("l22-set-on-one-path", "function drop(x, n) { if (n > 0) return drop(x, n - 1); if (x.v & 1) x = null; churn(); return x ? x.v : -1; }\nfunction run(k) { const o = make(k); said += drop(o, 2) + ' '; look(o); }\nrun(1); run(2);")
for n, t in P.items(): open(os.path.join(out, n), "w").write(t)
print(len(P), "programs")
