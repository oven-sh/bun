#!/usr/bin/env python3
"""sloppy-functions-bound-lazily.py <folder>: ONE CASE A FOLDER: in a sloppy script that says neither require nor module nor exports a top-level function declaration is BOUND ON FIRST USE; one whose name is stored to (by a direct eval) and whose arguments object shows it gets its own scope THERE.
THE QUESTION: WHERE is "there"? The first use stands in another function, in one that is never called, in a branch not taken, in a loop, a generator, an async function, a class, a default value, a getter, a callback that runs later: is the function ONE function, with one identity, its own properties, its own name, whoever asks first?
NO CASE SAYS require, module OR exports: that would take the file off this road."""
import os, sys
out = sys.argv[1]; cases = {}
F = 'function f(text) { return eval(text === undefined ? "1 + 1" : text); }\n'
T = 'const say = g => { try { const v = g(); return typeof v === "function" ? "fn " + v.name : String(v); } catch (e) { return "THROWS " + e.name; } };\n'
def case(name, body): cases[name] = {"main.cjs": T + body}
case("used-ahead-of-its-text", 'console.log(say(() => f()), say(() => f("f") === f));\n' + F)
case("first-use-in-another-function", F + 'function user() { return f; }\nconst a = user(), b = user();\nconsole.log(a === b, a === f, say(() => a()), say(() => a("arguments.callee") === f));\n')
case("first-use-in-a-function-never-called", 'function never() { return f; }\nconsole.log(say(() => f()), say(() => f("f") === f), typeof never);\n' + F)
case("first-use-in-a-branch-not-taken", 'if (Date.now() < 0) console.log(f());\nconsole.log(say(() => f()), say(() => f("arguments.callee") === f));\n' + F)
case("first-use-in-a-loop", F + 'const seen = new Set(); for (let i = 0; i < 5; i++) seen.add(f);\nconsole.log(seen.size, say(() => [...seen][0]("f") === f));\n')
case("first-use-in-a-function-called-often", F + 'function user() { return f; }\nconst seen = new Set(); for (let i = 0; i < 300; i++) seen.add(user());\nconsole.log(seen.size, seen.has(f));\n')
case("two-functions-ask-first", F + 'function a() { return f; } function b() { return f; }\nconsole.log(b() === a(), a() === f, say(() => b()("f") === a()));\n')
case("first-use-in-a-generator", F + 'function* g() { yield f; yield f; }\nconst [x, y] = [...g()];\nconsole.log(x === y, x === f, say(() => x()));\n')
case("first-use-in-an-async-function", F + 'async function g() { const a = f; await null; return [a, f]; }\ng().then(([a, b]) => console.log(a === b, a === f, say(() => a("f") === f)));\n')
case("first-use-in-a-class", F + 'class K { static s = f; m() { return f; } static { K.t = f; } get g() { return f; } }\nconsole.log(K.s === f, new K().m() === f, K.t === f, new K().g === f);\n')
case("first-use-in-a-default-value", F + 'function user(v = f) { return v; }\nconsole.log(user() === user(), user() === f);\n')
case("first-use-in-a-callback-that-runs-later", 'setTimeout(() => console.log("later", late === f, say(() => f())), 1);\nlet late;\nfunction early() { late = f; }\nearly();\n' + F)
case("first-use-in-a-try-and-a-finally", F + 'let a, b; try { a = f; throw 1; } catch (e) { b = f; } finally { console.log(a === b, a === f); }\n')
case("first-use-in-an-eval-at-the-top", F + 'console.log(say(() => eval("f") === f), say(() => eval("f()")), say(() => (0, eval)("typeof f")));\n')
case("first-use-by-typeof", 'console.log(typeof f, say(() => f.name), say(() => f.length));\n' + F + 'console.log(say(() => f()));\n')
case("its-own-properties", F + 'f.count = 1; function user() { return f.count; }\nconsole.log(user(), say(() => f("f.count")), say(() => f("arguments.callee.count")), say(() => { f("f.count = 5"); return f.count; }));\n')
case("as-a-constructor", 'function P(text) { this.v = eval(text); }\nP.prototype.hi = function () { return "hi " + this.v; };\nfunction make() { return new P("1 + 1"); }\nconsole.log(make().hi(), make() instanceof P, make().constructor === P, say(() => new P("new.target") .v === P), say(() => new P("arguments.callee").v === P));\n')
case("declared-twice", 'function f() { return eval("1"); }\nconsole.log(say(() => f()));\nfunction f() { return eval("2"); }\nconsole.log(say(() => f()), say(() => f.name));\n')
case("a-var-of-the-same-name", 'console.log(typeof f);\nvar f;\n' + F + 'console.log(typeof f, say(() => f()));\nvar f = 5;\nconsole.log(typeof f);\n')
case("stored-to-at-the-top", F + 'const first = f; f = 7;\nfunction user() { return f; }\nconsole.log(user(), say(() => first("f")), say(() => first("arguments.callee") === first), say(() => { first("f = 8"); return user(); }));\n')
case("stored-to-ahead-of-the-first-read", 'f = "stored first";\nfunction user() { return f; }\nconsole.log(user());\n' + F)
case("recursion-by-name-and-by-eval", 'function fact(n) { return n <= 1 ? 1 : n * eval("fact")(n - 1); }\nfunction twice(n) { return n <= 0 ? 0 : 1 + twice(n - 1) + (eval("0")); }\nconsole.log(fact(6), twice(50));\n')
case("they-see-one-another-and-top-level-names", 'var v = "var"; let l = "let"; const c = "const";\nfunction a(t) { return eval(t); }\nfunction b(t) { return eval(t); }\nfunction user() { return [a("v + l + c"), b("a") === a, a("b") === b, a(\'b("v")\')].join(); }\nconsole.log(user()); a("v = 1; l = 2"); console.log(v, l, say(() => a("c = 3")), c);\n')
case("the-let-is-not-yet-there", 'function f(t) { return eval(t); }\nconsole.log(say(() => f("later")), say(() => f("typeof later")));\nlet later = 1;\nconsole.log(say(() => f("later")));\n')
case("a-hundred-of-them", "".join('function f%d(t) { return eval(t) + %d; }\n' % (i, i) for i in range(100)) + 'let s = 0; for (const g of [' + ", ".join("f%d" % i for i in range(100)) + ']) s += g("1");\nconsole.log(s, say(() => f7("f99") === f99), say(() => f99("arguments.callee") === f99));\n')
case("arguments-shown-without-an-eval", 'function f(a, b) { const o = { get f() { return f; }, set f(v) { f = v; }, args: arguments }; return o; }\nfunction user() { return f(1, 2); }\nconst o = user(), p = user();\nconsole.log(o.f === p.f, o.args.callee === f, o.args.length, o.args[1]); const first = f; o.f = 9; console.log(f, first(3).args.callee === first);\n')
case("this-and-call", F.replace('"1 + 1"', '"this"') + 'function user() { return f.call(5) instanceof Number; }\nconsole.log(user(), say(() => f() === globalThis), say(() => f.call("s", "typeof this")), say(() => f.apply(null, ["arguments.length"])), say(() => f.bind(1)("this") == 1));\n')
case("handed-out-and-called-from-outside", F + 'console.log([undefined, "2 + 2", "f"].map(f).map(v => typeof v === "function" ? v === f : v).join(), say(() => Reflect.apply(f, null, ["3"])), say(() => new Function("g", "return g(\'4\')")(f)));\n')
for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for n, text in files.items():
        assert not any(w in text for w in ("require", "module", "exports")), name
        open(os.path.join(out, name, n), "w").write(text)
print(len(cases), "cases")
