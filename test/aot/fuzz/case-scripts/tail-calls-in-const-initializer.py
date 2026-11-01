#!/usr/bin/env python3
"""tail-calls-in-const-initializer.py <folder>: The initializer of a top-level constant ends in a call to another
function, which reads, stores or throws. Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
G = "const given = JSON.parse('{ \"off\": false }');\n"
F = {
 "t1-a-tail-call-reads-a-field": 'const source = { v: 1 };\nfunction look() { return source.v; }\nfunction make() { return look(); }\nconst held = make();\nfunction use() { return held; }\nsource.v = 2;\nconsole.log(use());\n',
 "t1b-two-tail-calls-deep": 'const source = { v: 1 };\nfunction look() { return source.v; }\nfunction through() { return look(); }\nfunction make() { return through(); }\nconst held = make();\nfunction use() { return held; }\nsource.v = 2;\nconsole.log(use());\n',
 "t1c-a-tail-call-reads-a-let": 'let source = 1;\nfunction look() { return source; }\nfunction make() { return look(); }\nconst held = make();\nfunction use() { return held; }\nsource = 2;\nconsole.log(use());\n',
 "t1d-a-tail-call-in-a-literal": 'const source = { v: 1 };\nfunction look() { return source.v; }\nfunction pick() { return look(); }\nfunction make() { return { v: pick(), l: [1, 2, 3], m: { a: 1 } }; }\nconst held = make();\nfunction use() { return held; }\nsource.v = 2;\nconsole.log(use().v);\n',
 "t2-a-tail-call-hands-back-a-shared-object": 'const shared = { v: 1 };\nfunction make() { const get = () => shared; return get(); }\nfunction fill() { const o = make(); o.v = 2; return { a: [1, 2, 3], b: { c: 1 } }; }\nconst held = fill();\nfunction use() { return held; }\nconsole.log(shared.v);\nif (given.off) console.log(use());\n',
 "t2b-by-a-declared-function": 'const shared = { v: 1 };\nfunction get() { return shared; }\nfunction make() { return get(); }\nfunction fill() { const o = make(); o.v = 2; return { a: [1, 2, 3], b: { c: 1 } }; }\nconst held = fill();\nfunction use() { return held; }\nconsole.log(shared.v);\nif (given.off) console.log(use());\n',
 "t2c-a-shared-list": 'const shared = [1];\nfunction make() { const get = () => shared; return get(); }\nfunction fill() { const o = make(); o[0] = 2; return { a: [1, 2, 3], b: { c: 1 } }; }\nconst held = fill();\nfunction use() { return held; }\nconsole.log(shared[0]);\nif (given.off) console.log(use());\n',
 "t2d-a-shared-function": 'const shared = function () {};\nfunction make() { const get = () => shared; return get(); }\nfunction fill() { const o = make(); o.v = 2; return { a: [1, 2, 3], b: { c: 1 } }; }\nconst held = fill();\nfunction use() { return held; }\nconsole.log(shared.v);\nif (given.off) console.log(use());\n',
 "t3-a-tail-call-of-what-is-no-function": 'const x = given.off ? () => 1 : 0;\nfunction make() { return x(); }\nprocess.on("uncaughtException", error => { console.log("uncaught", error.name); process.exit(0); });\nconst held = make();\nfunction use() { return held; }\nif (given.off) console.log(use());\nconsole.log("returned");\n',
 "t3b-in-a-method-of-a-literal": 'function scene(arrives) {\n  let x = arrives;\n  if (given.off) x = () => 1;\n  ({ answers() { return x(); } }).answers();\n}\ntry { scene(0); console.log("returned"); } catch (error) { console.log(error.name); }\n',
 "t3c-new-in-tail-position": 'function scene(arrives) {\n  let x = arrives;\n  if (given.off) x = function () {};\n  ({ answers() { return new x(); } }).answers();\n}\ntry { scene(() => 1); console.log("returned"); } catch (error) { console.log(error.name); }\n',
 "t3d-a-class-in-tail-position": 'function scene(arrives) {\n  let x = arrives;\n  if (given.off) x = () => 1;\n  ({ answers() { return x(); } }).answers();\n}\ntry { scene(class {}); console.log("returned"); } catch (error) { console.log(error.name); }\n',
 "t3e-a-member-in-tail-position": 'function scene(arrives) {\n  let x = arrives;\n  if (given.off) x = () => 1;\n  ({ answers() { return ({ m: x }).m(); } }).answers();\n}\ntry { scene(0); console.log("returned"); } catch (error) { console.log(error.name); }\n',
 "t4-a-tail-call-prints": 'function say() { console.log("ran"); return 1; }\nfunction make() { return say(); }\nconst held = make();\nfunction use() { return held; }\nconsole.log("between");\nconsole.log(use());\n',
 "t5-a-tail-call-counts": 'let count = 0;\nfunction next() { return ++count; }\nfunction make() { return next(); }\nconst held = make();\nfunction use() { return held; }\ncount = 10;\nconsole.log(use(), count);\n',
 "t6-a-conditional-tail-call": 'const source = { v: 1 };\nfunction look() { return source.v; }\nfunction make(flag) { return flag ? look() : 0; }\nconst held = make(!given.off);\nfunction use() { return held; }\nsource.v = 2;\nconsole.log(use());\n',
}
for name, text in F.items(): open(f"{out}/{name}.mjs", "w").write(G + text)
print(len(F))
