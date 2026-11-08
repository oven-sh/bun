#!/usr/bin/env python3
"""omitted-arguments.py <folder>: Writes one file per case. Arguments that are left out, written as undefined, or too many, for each shape of callee; and functions
whose fresh object or list the caller takes apart at once.
"""
import os, sys
out = sys.argv[1]
H = 'let said = "";\nconst none = Number(process.argv[9] ?? 0);\nconst nothing = process.argv[9];\nfunction kind(v) { return v === undefined ? "u" : v === null ? "n" : typeof v === "object" ? "o" + v.v : typeof v + ":" + v; }\nconst obj = { v: 1 }, other = { v: 2 };\n'
P = {}
def p(n, b, ext="mjs"): P[n + "." + ext] = H + b + "\nconsole.log(said);\n"
calls3 = ["F()", "F(obj)", "F(obj, undefined)", "F(obj, undefined, undefined)", "F(undefined)", "F(undefined, obj)", "F(undefined, undefined, obj)", "F(obj, other)", "F(obj, undefined, other)", "F(obj, other, undefined)", "F(obj, other, obj, other)", "F(obj, nothing)", "F(nothing, obj, nothing)", "F(obj, void 0, null)", "F(null)", "F(obj, 1.5)", "F(1.5, undefined, 2)", "F(...[])", "F(...[obj])", "F(...[obj, undefined])", "F(obj, ...[undefined, other])"]
def run(body, name="F", calls=calls3): return body + "\nfunction run() {\n" + "\n".join("  said += %s + ' ';" % c.replace("F(", name + "(") for c in calls) + "\n}\nrun();"
REC = "if (depth > 0) { depth--; return F(%s); } depth = 1;"
p("o01-three-parameters", "let depth = 1;\n" + run("function F(a, b, c) { return kind(a) + kind(b) + kind(c); }"))
p("o02-counts-its-arguments", run("function F(a, b, c) { return arguments.length + kind(a) + kind(b) + kind(c); }"))
p("o03-defaults", run("function F(a = other, b = 5, c = a) { return kind(a) + kind(b) + kind(c); }"))
p("o04-rest", run("function F(a, ...rest) { return kind(a) + rest.length + kind(rest[0]) + kind(rest[1]); }"))
p("o05-not-inlined", run("function F(a, b, c, n = 2) { return n > 0 ? F(a, b, c, n - 1) : kind(a) + kind(b) + kind(c); }"))
p("o06-not-inlined-leaves-out-itself", run("function F(a, b, c) { if (a === obj && b === undefined && c === undefined) return 'x' + F(other); if (a === other && b === undefined) return 'y' + F(null, a); return kind(a) + kind(b) + kind(c); }"))
p("o07-ten-parameters", run("function F(a, b, c, d, e, f, g, h, i, j) { return kind(a) + kind(b) + kind(c) + kind(h) + kind(i) + kind(j) + arguments.length; }", calls=calls3 + ["F(obj, 1, 2, 3, 4, 5, 6, 7)", "F(obj, 1, 2, 3, 4, 5, 6, 7, undefined)", "F(obj, 1, 2, 3, 4, 5, 6, undefined, other)", "F(obj, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, other)", "F(obj, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)"]))
p("o08-method", run("class C { m(a, b, c) { return (this === it ? 't' : 'f') + kind(a) + kind(b) + kind(c); } }\nconst it = new C();", name="it.m"))
p("o09-constructor", run("class C { constructor(a, b = 5, c) { this.s = kind(a) + kind(b) + kind(c) + arguments.length; } }\nfunction F(...all) { return new C(...all).s; }") + "\nsaid += new C().s + ' ' + new C(obj).s + ' ' + new C(obj, undefined).s + ' ' + new C(obj, undefined, other).s;")
p("o10-arrow", run("const F = (a, b, c) => kind(a) + kind(b) + kind(c);"))
p("o11-writes-a-left-out-parameter", run("function F(a, b, c) { if (b === undefined) b = other; if (c === undefined) c = b; return kind(a) + kind(b) + kind(c) + arguments.length; }"))
p("o12-sloppy-mapped-arguments", run("function F(a, b, c) { b = other; arguments[2] = obj; return kind(a) + kind(arguments[1]) + kind(c) + arguments.length; }"), "cjs")
p("o13-captured-parameters", run("function F(a, b, c) { const get = () => kind(a) + kind(b) + kind(c); return launder(get)(); }\nconst launder = new Function('v', process.argv[8] ?? 'return v');"))
T = 'let said: string = "";\nconst G: any = globalThis;\nconst none: number = Number(G.process.argv[9] ?? 0);\n'
def t(n, b): P[n + ".ts"] = T + b + "\nconsole.log(said);\n"
t("o20-optional-numbers", "function F(a: number, b?: number, c?: number, n: number = 2): string { return n > 0 ? F(a, b, c, n - 1) : a + ':' + b + ':' + c; }\nfunction run(): void { said += F(1) + ' ' + F(1, undefined) + ' ' + F(1, 2.5) + ' ' + F(1, undefined, 3) + ' ' + F(1.5, none / none) + ' ' + F(1, -0, undefined) + ' ' + F(1, 2, 3); }\nrun();")
t("o21-optional-of-each-kind", "interface R { v: number }\nfunction F(a?: R, b?: string, c?: boolean, d?: number, e?: bigint, n: number = 2): string { return n > 0 ? F(a, b, c, d, e, n - 1) : (a ? a.v : 'u') + ':' + b + ':' + c + ':' + d + ':' + e; }\nfunction run(): void { said += F() + ' ' + F({ v: 1 }) + ' ' + F(undefined, 's') + ' ' + F(undefined, undefined, false) + ' ' + F(undefined, undefined, undefined, 0) + ' ' + F(undefined, undefined, undefined, undefined, 0n) + ' ' + F({ v: 2 }, '', true, -0, 1n); }\nrun();")
t("o22-doubles-between-references", "interface R { v: number }\nfunction F(a: R, x: number, b?: R, y?: number, c?: R, n: number = 2): string { return n > 0 ? F(a, x, b, y, c, n - 1) : a.v + ':' + x + ':' + (b ? b.v : 'u') + ':' + y + ':' + (c ? c.v : 'u'); }\nconst r: R = { v: 1 }, s: R = { v: 2 };\nfunction run(): void { said += F(r, 0.5) + ' ' + F(r, 0.5, undefined, 1.5) + ' ' + F(r, 0.5, s) + ' ' + F(r, 0.5, undefined, undefined, s) + ' ' + F(r, 0.5, s, 2.5, r); }\nrun();")
# results that the caller takes apart
def fields(k): return ["f%d" % i for i in range(k)]
for k in (1, 2, 3, 5, 8, 9, 12, 20):
    fs = fields(k)
    vals = [["n + %d" % i, "n + %d.5" % i, "'s' + (n + %d)" % i, "(n + %d) %% 2 === 0" % i, "{ v: n + %d }" % i][i % 5] for i in range(k)]
    shows = ["%s" % f if i % 5 != 4 else "%s.v" % f for i, f in enumerate(fs)]
    p("m%02d-record-of-%d" % (k, k), "function make(n, d) { if (d > 0) return make(n + 1, d - 1); return { %s }; }\nfunction run(n) { const { %s } = make(n, 2); said += %s + ' '; }\nrun(1); run(10);" % (", ".join("%s: %s" % (f, v) for f, v in zip(fs, vals)), ", ".join(fs), " + ':' + ".join(shows)))
    p("m%02d-list-of-%d" % (k, k), "function make(n, d) { if (d > 0) return make(n + 1, d - 1); return [%s]; }\nfunction run(n) { const [%s] = make(n, 2); said += %s + ' '; }\nrun(1); run(10);" % (", ".join(vals), ", ".join(fs), " + ':' + ".join(shows)))
p("m30-one-path-returns-another-shape", "function make(n) { if (n & 1) return { a: n, b: n + 0.5 }; return { b: 's', a: null, c: 1 }; }\nfunction run(n) { const { a, b, c } = make(n); said += a + ':' + b + ':' + c + ' '; }\nrun(1); run(2);")
p("m31-one-path-returns-nothing", "function make(n) { if (n & 1) return { a: n, b: n + 0.5 }; }\nfunction run(n) { const r = make(n); said += (r ? r.a + ':' + r.b : 'none') + ' '; }\nrun(1); run(2);")
p("m32-result-also-escapes", "let last;\nfunction make(n) { const r = { a: n, b: n + 0.5 }; if (n === 3) last = r; return r; }\nfunction run(n) { const { a, b } = make(n); said += a + ':' + b + ' '; }\nrun(1); run(3); last.a = 9; said += last.a + ':' + last.b;")
p("m33-thrown-in-between", "function make(n) { const a = n + 1; if (n === 2) throw new Error('e' + a); return { a, b: a + 0.5 }; }\nfunction run(n) { try { const { a, b } = make(n); said += a + ':' + b + ' '; } catch (e) { said += e.message + ' '; } }\nrun(1); run(2); run(3);")
p("m34-in-the-place-of-a-return", "function inner(n) { return { a: n, b: n + 0.5, c: 's' + n }; }\nfunction outer(n) { return inner(n + 1); }\nfunction run(n) { const { a, b, c } = outer(n); said += a + ':' + b + ':' + c + ' '; }\nrun(1); run(2);")
p("m35-getter-in-the-result", "let reads = 0;\nfunction make(n) { return { a: n, get b() { reads++; return n + 0.5; } }; }\nfunction run(n) { const { a, b } = make(n); said += a + ':' + b + ':' + reads + ' '; }\nrun(1); run(2);")
p("m36-identity-of-the-result", "function make(n) { return { a: n }; }\nfunction run(n) { const r = make(n), s = make(n); said += (r === s) + ':' + (r === r) + ':' + r.a + ' '; }\nrun(1);")
p("m37-swapped-by-a-pattern", "function pair(a, b, d) { return d > 0 ? pair(b, a, d - 1) : [a, b]; }\nfunction run() { let x = 1, y = 2.5; for (let i = 0; i < 3; i++) { [x, y] = pair(x, y, i); said += x + ':' + y + ' '; } }\nrun();")
for n, x in P.items(): open(os.path.join(out, n), "w").write(x)
print(len(P), "programs")
