#!/usr/bin/env python3
"""readonly-stores-in-const-initializer.py <folder>: The initializer of a top-level constant stores under a name that
another function has defined as read-only, as an accessor, or on the prototype chain. Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
G0 = "const given = JSON.parse('{ \"off\": false }');\n"
H = G0 + 'process.on("uncaughtException", error => { console.log("uncaught", error.name); process.exit(0); });\n'
T = 'const held = make();\nfunction use() { return held; }\nif (given.off) console.log(use());\nconsole.log("returned");\n'
F = {
 "s10-store-in-a-helper-behind-a-descriptor": H + 'function set(f) { f.k = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); set(f); return f; }\n' + T,
 "s10b-read-late": H + 'function set(f) { f.k = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); set(f); return f; }\nconst held = make();\nfunction use() { return held; }\nconsole.log("between");\nconsole.log(use().k);\n',
 "s10c-in-a-method-of-a-literal": 'function set(f) { f.k = 2; }\nfunction scene() { ({ answers() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); set(f); } }).answers(); }\ntry { scene(); console.log("returned"); } catch (error) { console.log(error.name); }\n',
 "s10d-the-descriptor-in-a-helper-too": H + 'function define(f) { Object.defineProperty(f, "k", { value: 1 }); }\nfunction set(f) { f.k = 2; }\nfunction make() { const f = function () {}; define(f); set(f); return f; }\n' + T,
 "s21-store-under-another-name": H + 'function make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); const g = given.off ? function () {} : f; g.k = 2; return g; }\n' + T,
 "s21b-at-the-top-level": H + 'const f = function () {};\nObject.defineProperty(f, "k", { value: 1 });\nconst g = given.off ? function () {} : f;\ng.k = 2;\nconsole.log("returned");\n',
 "s22-two-definitions-in-helpers": H + 'function define(f, v) { Object.defineProperty(f, "k", { value: v }); }\nfunction make() { const f = function () {}; define(f, 1); define(f, 2); return f; }\n' + T,
 "s23-one-here-one-in-a-helper": H + 'function define(f, v) { Object.defineProperty(f, "k", { value: v }); }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); define(f, 2); return f; }\n' + T,
 "s24-an-arrow": H + 'function set(f) { f.label = "b"; }\nfunction make() { const f = () => 1; Object.defineProperty(f, "label", { value: "a", enumerable: true }); set(f); return f; }\n' + T,
 "s25-a-class": H + 'function set(f) { f.k = 2; }\nfunction make() { class C {} Object.defineProperty(C, "k", { value: 1 }); set(C); return C; }\n' + T,
 "s26-a-symbol-key": H + 'function set(f) { f[Symbol.iterator] = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, Symbol.iterator, { value: 1 }); set(f); return f; }\n' + T,
 "s27-a-closure-stores": H + 'function make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); const set = () => { f.k = 2; }; set(); return f; }\n' + T,
 "s28-handed-back-by-a-helper": H + 'function locked() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); return f; }\nfunction make() { const f = locked(); f.k = 2; return f; }\n' + T,
 "s28b-handed-back-and-defined-again": H + 'function locked() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); return f; }\nfunction make() { const f = locked(); Object.defineProperty(f, "k", { value: 2 }); return f; }\n' + T,
 "s29-a-template-object": H + 'function tag(strings) { strings[0] = "b"; return { a: [1, 2, 3], b: { c: 1 } }; }\nconst held = tag`a`;\nfunction use() { return held; }\nif (given.off) console.log(use());\nconsole.log("returned");\n',
 "s30-writable-by-descriptor": H + 'function set(f) { f.k = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1, writable: true }); set(f); return f; }\nconst held = make();\nfunction use() { return held; }\nconsole.log("returned", use().k);\n',
 "s31-a-static-field-behind-a-static-block": H + 'function make() { return class { static { Object.defineProperty(this, "k", { value: 1 }); } static k = 2; }; }\n' + T,
 "s32-store-in-a-helper-two-deep": H + 'function set(f) { f.k = 2; }\nfunction through(f) { set(f); }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); through(f); return f; }\n' + T,
 "s33-held-by-a-literal": H + 'function set(o) { o.f.k = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); const o = { f }; set(o); return o; }\n' + T,
 "s34-delete-in-a-helper": H + 'function drop(f) { delete f.k; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); drop(f); return f; }\n' + T,
 "s35-define-by-a-static-field-of-a-subclass": H + 'function make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); class D extends f {} D.k = 2; return D; }\n' + T,
 "s36-store-on-a-function-below": H + 'function set(g) { g.k = 2; }\nfunction make() { const f = function () {}; Object.defineProperty(f, "k", { value: 1 }); const g = function () {}; Object.setPrototypeOf(g, f); set(g); return g; }\n' + T,
}
for name, text in F.items(): open(f"{out}/{name}.mjs", "w").write(text)
print(len(F))
