#!/usr/bin/env python3
"""direct-eval-visibility.py <folder>: ONE CASE A FOLDER: what a direct eval sees of the module it stands in: by where the eval stands x what kind of name x the kind of file."""
import os, sys
out = sys.argv[1]; cases = {}
DECL = {
 "const": ('const name = "the const";', 'name'), "let": ('let name = "the let";', 'name'), "var": ('var name = "the var";', 'name'), "function": ('function name() { return "the function"; }', 'name()'),
 "class": ('class name { static s = "the class"; }', 'name.s'), "exported-const": ('export const name = "the exported const";', 'name'), "exported-function": ('export function name() { return "the exported function"; }', 'name()'),
 "import": ('import { name } from "./other";', 'name'), "import-namespace": ('import * as name from "./other";', 'name.name'), "import-default": ('import name from "./other";', 'name'),
}
WHERE = {
 "top-level": 'console.log(eval(CODE)); console.log(eval(TYPEOF));',
 "function": 'function f(code) { return eval(code); }\nconsole.log(f(CODE)); console.log(f(TYPEOF));',
 "arrow": 'const f = (code) => eval(code);\nconsole.log(f(CODE)); console.log(f(TYPEOF));',
 "method": 'class K { m(code) { return eval(code); } }\nconsole.log(new K().m(CODE)); console.log(new K().m(TYPEOF));',
 "nested-function": 'function g() { return function (code) { return eval(code); }; }\nconsole.log(g()(CODE)); console.log(g()(TYPEOF));',
 "async-function": 'async function f(code) { await 0; return eval(code); }\nconsole.log(await f(CODE)); console.log(await f(TYPEOF));',
}
for ext in ("js", "ts"):
    for d, (decl, use) in DECL.items():
        for w, text in WHERE.items():
            body = text.replace("CODE", repr(use).replace("'", '"')).replace("TYPEOF", '"typeof name"')
            if ext == "ts": body = body.replace("eval(code)", "EVAL").replace("(code)", "(code: string): unknown").replace("async function f(code: string): unknown", "async function f(code: string): Promise<unknown>").replace("EVAL", "eval(code)")
            # the name is also used by ordinary code in half of the cases, so that it is not dropped as unused
            for used in ("", "-and-is-used"):
                extra = ('console.log("used:", typeof name);\n' if used else "")
                cases[f"{ext}-{d}-seen-from-{w}{used}"] = {f"main.{ext}": decl + "\n" + extra + body + "\n", f"other.{ext}": 'export const name = "the import";\nexport default "the default import";\n'}
for name, files in cases.items():
    os.makedirs(f"{out}/{name}", exist_ok=True)
    for f, text in files.items(): open(f"{out}/{name}/{f}", "w").write(text)
print(len(cases), "cases")
