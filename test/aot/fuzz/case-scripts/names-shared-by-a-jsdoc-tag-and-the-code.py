#!/usr/bin/env python3
"""names-shared-by-a-jsdoc-tag-and-the-code.py <folder>: A comment changes nothing, also where it names what the code names.
`/** @import { f } from "./x.js" */` beside `function f() {}` and `export { f }`: the tag's clause and the function were one
symbol, and the export was taken for the type import, which is erased: `import { f }` stopped the build with "No matching
export", and `import * as all` built and had no `f`: silent. The tags that bind a name (twelve forms of @import, @typedef,
@callback, @template, @enum, @type) x what the code declares under that name (function, class, let, const, var, a pattern, an
import) x how the name leaves the file x how the other file takes it; the tags that only describe, on a few of those; a `let`
read live, a class as a base, CommonJS, the entry point itself, two files with the name. One folder a case: main.mjs or
main.cjs, helper, and the files that the tag names. real.mjs prints when it runs: a comment must not run it.
"""
import itertools, os, sys

OUT = sys.argv[1]
TAGS = {
    "import-named-missing": '@import { N } from "./nothing.js"', "import-named-real": '@import { N } from "./real.mjs"', "import-named-types": '@import { N } from "./types"', "import-default": '@import N from "./nothing.js"', "import-default-real": '@import N from "./real.mjs"',
    "import-star": '@import * as N from "./nothing.js"', "import-star-real": '@import * as N from "./real.mjs"', "import-renamed": '@import { other as N } from "./real.mjs"', "import-renamed-away": '@import { N as other } from "./real.mjs"', "import-both": '@import N, { other } from "./real.mjs"',
    "import-typeof": "@import {typeof N} g", "import-node": '@import { N } from "node:fs"', "typedef": "@typedef {number} N", "typedef-object": "@typedef {Object} N\n * @property {number} a", "typedef-import": '@typedef {import("./real.mjs").N} N', "callback": "@callback N\n * @param {number} a",
    "template": "@template N", "enum": "@enum {number}", "type": "@type {N}", "param": "@param {N} N", "class": "@class N", "namespace": "@namespace N", "module": "@module N", "name": "@name N", "alias": "@alias N", "exports": "@exports N", "function": "@function N", "satisfies": "@satisfies {N}",
}
DECLS = {
    "function": "function N(x) {\n  return 1;\n}", "async-function": "async function N(x) {\n  return 1;\n}", "class": "class N {\n  static v = 1;\n}", "const": "const N = 1;", "let": "let N = 1;", "var": "var N = 1;", "arrow": "const N = () => 1;", "object": "const N = { a: 1 };",
    "pattern": "const { N } = { N: 1 };", "imported": 'import { N } from "./values.mjs";',
}
SHOW = 'const show = (v) => (typeof v === "function" ? "function " + v.name : JSON.stringify(v));\n'
LEAVES = {  # how the name leaves helper.mjs, and main.mjs
    "named": ("export { N };", 'import { N } from "./helper.mjs";\nconsole.log(show(N));'), "renamed": ("export { N as g };", 'import { g } from "./helper.mjs";\nconsole.log(show(g));'), "default": ("export default N;", 'import d from "./helper.mjs";\nconsole.log(show(d));'),
    "named-and-default": ("export { N };\nexport default N;", 'import d, { N } from "./helper.mjs";\nconsole.log(show(d), show(N));'), "namespace": ("export { N };", 'import * as all from "./helper.mjs";\nconsole.log(Object.keys(all), show(all.N));'),
    "star": ("export { N };", 'import * as all from "./barrel.mjs";\nimport { N } from "./barrel.mjs";\nconsole.log(Object.keys(all), show(N));'), "import-call": ("export { N };", 'const all = await import("./helper.mjs");\nconsole.log(Object.keys(all), show(all.N));'),
    "required": ("export { N };", 'import { createRequire } from "node:module";\nconst all = createRequire(import.meta.url)("./helper.mjs");\nconsole.log(Object.keys(all), show(all.N));'), "used-here": ("export const answer = [typeof N, { N }.N === N];", 'import { answer } from "./helper.mjs";\nconsole.log(answer);'),
    "closure": ("export const get = () => N;", 'import { get } from "./helper.mjs";\nconsole.log(show(get()));'), "as-string-name": ('export { N as "a name" };', 'import { "a name" as g } from "./helper.mjs";\nconsole.log(show(g));'),
}

SIDE = {"real.mjs": 'console.log("real.mjs runs");\nexport const N = "of real.mjs";\nexport const other = "other of real.mjs";\nexport default "default of real.mjs";\n', "types.d.ts": "export type N = number;\n", "values.mjs": 'export const N = "of values.mjs";\n', "barrel.mjs": 'export * from "./helper.mjs";\n'}


def put(case, files):
    text = "".join(t for k, t in files.items() if k not in SIDE)
    folder = os.path.join(OUT, case)
    os.makedirs(folder, exist_ok=True)
    for k, t in files.items():
        if k not in SIDE or "./" + k.split(".")[0] in text:
            open(os.path.join(folder, k), "w").write(t)


for (tk, tag), (dk, decl), (lk, (leave, main)) in itertools.product(TAGS.items(), DECLS.items(), LEAVES.items()):
    c = "/** " + tag + " */" if "\n" not in tag else "/**\n * " + tag + "\n */"
    binds = tk.startswith(("import", "typedef", "callback", "template", "enum", "type"))
    if not binds and (dk not in ("function", "class", "const") or lk not in ("named", "namespace", "default")):
        continue
    for where in ("in-front", "at-the-top"):
        if where == "at-the-top" and (not tk.startswith(("import", "typedef", "callback")) or dk not in ("function", "class", "let")):
            continue
        text = (c + "\n" + decl if where == "in-front" else c + "\nconst first = 0;\n" + decl) + "\n" + leave + "\n"
        put(f"{tk}.{dk}.{lk}.{where}", {**SIDE, "helper.mjs": text, "main.mjs": SHOW + main + "\n"})
# a let that is read live, a class that is a base, CommonJS
for tk, tag in TAGS.items():
    c = "/** " + tag + " */" if "\n" not in tag else "/**\n * " + tag + "\n */"
    put(f"{tk}.let-read-live", {**SIDE, "helper.mjs": c + "\nlet N = 1;\nexport function bump() {\n  N++;\n}\nexport { N };\n", "main.mjs": 'import { N, bump } from "./helper.mjs";\nconst before = N;\nbump();\nconsole.log(before, N);\n'})
    put(f"{tk}.class-as-a-base", {**SIDE, "helper.mjs": c + "\nclass N {\n  m() {\n    return 1;\n  }\n}\nexport class Heir extends N {}\nexport { N };\n", "main.mjs": 'import { N, Heir } from "./helper.mjs";\nconsole.log(new Heir().m(), new Heir() instanceof N, Object.getPrototypeOf(Heir) === N);\n'})
    put(f"{tk}.commonjs-exports", {**SIDE, "helper.cjs": c + "\nfunction N(x) {\n  return 1;\n}\nexports.N = N;\n", "main.cjs": 'const all = require("./helper.cjs");\nconsole.log(Object.keys(all), all.N());\n'})
    put(f"{tk}.commonjs-module-exports", {**SIDE, "helper.cjs": c + "\nclass N {}\nmodule.exports = { N };\n", "main.cjs": 'const { N } = require("./helper.cjs");\nconsole.log(typeof N, N.name);\n'})
    put(f"{tk}.commonjs-imported", {**SIDE, "helper.cjs": c + "\nconst N = 1;\nmodule.exports = { N };\n", "main.mjs": 'import all, { N } from "./helper.cjs";\nconsole.log(Object.keys(all), N);\n'})
    put(f"{tk}.in-the-entry", {**SIDE, "main.mjs": c + "\nfunction N(x) {\n  return 1;\n}\nexport { N };\nconsole.log(N(), typeof N);\n"})
    put(f"{tk}.two-files-share-the-name", {**SIDE, "helper.mjs": c + "\nexport function N() {\n  return \"helper\";\n}\n", "second.mjs": c + "\nfunction N() {\n  return \"second\";\n}\nexport { N };\n", "main.mjs": 'import { N } from "./helper.mjs";\nimport { N as M } from "./second.mjs";\nconsole.log(N(), M());\n'})
