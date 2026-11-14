#!/usr/bin/env python3
"""which-file-of-a-package.py <folder>: Which file of a package a name leads to: some seventy shapes of package.json (main,
exports with conditions, subpaths, patterns, null targets, lists, imports, type, index files by extension, nested and
hoisted copies, self-reference), each asked for by require(), import() and require.resolve(), every one in a try. Every
file of every package exports the text of its own path inside the package, so a case prints which file it got, or the
code of the error. One folder a case: main.cjs or main.mjs and its node_modules. Left out, because every executable
differs from `bun <file>` there: "module" beside "main", and "sideEffects": false.
"""
import json, os, sys

ROOT = sys.argv[1]


def esm(tag):
    return f'export default "{tag}";\nexport const which = "{tag}";\n'


def cjs(tag):
    return f'module.exports = {{ which: "{tag}", default: "{tag}" }};\n'


def files(*names, kind=None):
    out = {}
    for n in names:
        if n.endswith(".json"):
            out[n] = json.dumps({"which": n, "default": n})
        elif n.endswith((".mjs", ".mts")) or kind == "esm":
            out[n] = esm(n)
        elif n.endswith(".ts"):
            out[n] = f'export default "{n}" as string;\nexport const which: string = "{n}";\n'
        else:
            out[n] = cjs(n)
    return out


# name: (package.json, files, subpaths to ask for besides the root)
P = {
    "main": ({"main": "lib/a.js"}, files("lib/a.js", "index.js"), []),
    "main-no-extension": ({"main": "lib/a"}, files("lib/a.js", "index.js"), []),
    "main-folder": ({"main": "lib"}, files("lib/index.js", "index.js"), []),
    "main-dot-slash": ({"main": "./lib/a.js"}, files("lib/a.js"), []),
    "main-missing": ({"main": "nothing.js"}, files("index.js"), []),
    "main-missing-all": ({"main": "nothing.js"}, files("other.js"), []),
    "no-main": ({}, files("index.js"), []),
    "no-package-json": (None, files("index.js"), []),
    "index-mjs-only": ({}, files("index.mjs"), []),
    "index-json-only": ({}, files("index.json"), []),
    "index-ts-only": ({}, files("index.ts"), []),
    "index-js-and-ts": ({}, files("index.js", "index.ts"), []),
    "index-js-and-json": ({}, files("index.js", "index.json"), []),
    "main-and-module": ({"main": "a.js", "module": "b.mjs"}, files("a.js", "b.mjs"), []),
    "module-only": ({"module": "b.mjs"}, files("b.mjs", "index.js"), []),
    "main-and-browser": ({"main": "a.js", "browser": "c.js"}, files("a.js", "c.js"), []),
    "type-module": ({"type": "module", "main": "a.js"}, files("a.js", kind="esm"), []),
    "type-commonjs": ({"type": "commonjs", "main": "a.js"}, files("a.js"), []),
    "type-module-with-cjs": ({"type": "module", "main": "a.cjs"}, files("a.cjs"), []),
    "exports-text": ({"exports": "./a.js", "main": "b.js"}, files("a.js", "b.js"), ["b.js"]),
    "exports-dot": ({"exports": {".": "./a.js"}, "main": "b.js"}, files("a.js", "b.js"), ["a.js"]),
    "exports-import-require": ({"exports": {"import": "./a.mjs", "require": "./b.cjs"}}, files("a.mjs", "b.cjs"), []),
    "exports-require-import": ({"exports": {"require": "./b.cjs", "import": "./a.mjs"}}, files("a.mjs", "b.cjs"), []),
    "exports-default-first": ({"exports": {"default": "./d.js", "import": "./a.mjs", "require": "./b.cjs"}}, files("a.mjs", "b.cjs", "d.js"), []),
    "exports-default-last": ({"exports": {"import": "./a.mjs", "default": "./d.js"}}, files("a.mjs", "d.js"), []),
    "exports-node": ({"exports": {"node": "./n.js", "default": "./d.js"}}, files("n.js", "d.js"), []),
    "exports-bun": ({"exports": {"bun": "./bun.js", "node": "./n.js", "default": "./d.js"}}, files("bun.js", "n.js", "d.js"), []),
    "exports-bun-last": ({"exports": {"node": "./n.js", "bun": "./bun.js", "default": "./d.js"}}, files("bun.js", "n.js", "d.js"), []),
    "exports-browser": ({"exports": {"browser": "./br.js", "default": "./d.js"}}, files("br.js", "d.js"), []),
    "exports-types-first": ({"exports": {"types": "./t.d.ts", "default": "./d.js"}}, {**files("d.js"), "t.d.ts": "export declare const which: string;\ndeclare const d: string;\nexport default d;\n"}, []),
    "exports-development": ({"exports": {"development": "./dev.js", "production": "./prod.js", "default": "./d.js"}}, files("dev.js", "prod.js", "d.js"), []),
    "exports-nested": ({"exports": {"node": {"import": "./ni.mjs", "require": "./nr.cjs"}, "default": "./d.js"}}, files("ni.mjs", "nr.cjs", "d.js"), []),
    "exports-nested-no-match": ({"exports": {"node": {"worker": "./w.js"}, "default": "./d.js"}}, files("w.js", "d.js"), []),
    "exports-dot-conditions": ({"exports": {".": {"import": "./a.mjs", "require": "./b.cjs"}, "./sub": "./s.js"}}, files("a.mjs", "b.cjs", "s.js"), ["sub", "s.js", "sub.js"]),
    "exports-list": ({"exports": ["./missing-one.js", "./a.js"]}, files("a.js"), []),
    "exports-list-of-conditions": ({"exports": [{"worker": "./w.js"}, "./a.js"]}, files("w.js", "a.js"), []),
    "exports-null": ({"exports": {".": "./a.js", "./hidden": None}}, files("a.js", "hidden.js"), ["hidden", "hidden.js"]),
    "exports-pattern": ({"exports": {".": "./a.js", "./lib/*": "./src/*.js"}}, files("a.js", "src/x.js", "src/deep/y.js"), ["lib/x", "lib/deep/y", "lib/none", "src/x.js"]),
    "exports-pattern-extension": ({"exports": {"./lib/*.js": "./src/*.js"}}, files("src/x.js"), ["lib/x.js", "lib/x"]),
    "exports-pattern-and-null": ({"exports": {"./lib/*": "./src/*.js", "./lib/private/*": None}}, files("src/x.js", "src/private/p.js"), ["lib/x", "lib/private/p"]),
    "exports-pattern-best": ({"exports": {"./*": "./any/*.js", "./lib/*": "./src/*.js"}}, files("any/x.js", "any/lib/x.js", "src/x.js"), ["x", "lib/x"]),
    "exports-folder": ({"exports": {"./lib/": "./src/"}}, files("src/x.js"), ["lib/x.js"]),
    "exports-subpath-conditions": ({"exports": {"./sub": {"import": "./si.mjs", "require": "./sr.cjs"}}}, files("si.mjs", "sr.cjs"), ["sub"]),
    "exports-no-dot": ({"exports": {"./sub": "./s.js"}, "main": "a.js"}, files("a.js", "s.js"), ["sub"]),
    "exports-empty": ({"exports": {}, "main": "a.js"}, files("a.js"), []),
    "exports-false": ({"exports": False, "main": "a.js"}, files("a.js"), []),
    "exports-target-missing": ({"exports": "./nothing.js", "main": "a.js"}, files("a.js"), []),
    "exports-target-outside": ({"exports": "../outside.js"}, files("a.js"), []),
    "exports-target-no-dot": ({"exports": "a.js"}, files("a.js"), []),
    "exports-package-json": ({"exports": {".": "./a.js", "./package.json": "./package.json"}}, files("a.js"), ["package.json"]),
    "exports-hides-package-json": ({"exports": {".": "./a.js"}}, files("a.js"), ["package.json"]),
    "exports-json-target": ({"exports": "./data.json"}, files("data.json"), []),
    "exports-ts-target": ({"exports": "./a.ts"}, files("a.ts"), []),
    "exports-module-sync": ({"exports": {"module-sync": "./ms.mjs", "default": "./d.js"}}, files("ms.mjs", "d.js"), []),
    "exports-module-condition": ({"exports": {"module": "./m.mjs", "default": "./d.js"}}, files("m.mjs", "d.js"), []),
    "no-exports-subpath": ({"main": "a.js"}, files("a.js", "lib/x.js", "lib/index.js", "data.json"), ["lib/x", "lib/x.js", "lib", "lib/", "data.json", "data", "package.json"]),
    "subpath-file-and-folder": ({"main": "a.js"}, files("a.js", "lib.js", "lib/index.js"), ["lib", "lib/", "lib.js"]),
    "subpath-package-json": ({"main": "a.js"}, {**files("a.js", "inner/b.js", "inner/index.js"), "inner/package.json": json.dumps({"main": "b.js"})}, ["inner"]),
    "imports-internal": ({"main": "a.js", "imports": {"#dep": "./dep.js"}}, {"a.js": 'module.exports = { which: require("#dep").which, default: require("#dep").which };\n', **files("dep.js")}, []),
    "imports-conditions": ({"main": "a.js", "imports": {"#dep": {"import": "./di.mjs", "require": "./dr.cjs"}}}, {"a.js": 'module.exports = { which: require("#dep").which, default: require("#dep").which };\n', **files("di.mjs", "dr.cjs")}, []),
    "imports-pattern": ({"main": "a.js", "imports": {"#lib/*": "./src/*.js"}}, {"a.js": 'module.exports = { which: require("#lib/x").which, default: require("#lib/x").which };\n', **files("src/x.js")}, []),
    "self-reference": ({"name": "alr-self-reference", "exports": {".": "./a.js", "./sub": "./s.js"}}, {"a.js": 'module.exports = { which: require("alr-self-reference/sub").which, default: "a.js" };\n', **files("s.js")}, []),
    "nested-dependency": ({"main": "a.js"}, {"a.js": 'module.exports = { which: require("alr-shared").which, default: "a.js" };\n', "node_modules/alr-shared/index.js": cjs("nested copy")}, []),
    "hoisted-dependency": ({"main": "a.js"}, {"a.js": 'module.exports = { which: require("alr-shared").which, default: "a.js" };\n'}, []),
    "marked-esmodule": ({"main": "a.js"}, {"a.js": 'Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = "a.js default";\nexports.which = "a.js";\n'}, []),
    "esm-with-default-only": ({"type": "module", "main": "a.js"}, {"a.js": 'export default { which: "a.js" };\n'}, []),
    "side-effects-false": ({"main": "a.js", "sideEffects": False}, {"a.js": 'console.log("a.js runs");\nmodule.exports = { which: "a.js", default: "a.js" };\n'}, []),
    "side-effects-false-esm": ({"type": "module", "main": "a.js", "sideEffects": False}, {"a.js": 'console.log("a.js runs");\nexport const which = "a.js";\nexport default "a.js";\n'}, []),
    "upper-case-main": ({"main": "Lib/A.js"}, files("Lib/A.js"), []),
    "main-is-json": ({"main": "data.json"}, files("data.json"), []),
    "main-is-mjs": ({"main": "a.mjs"}, files("a.mjs"), []),
    "main-is-ts": ({"main": "a.ts"}, files("a.ts"), []),
    "aot-condition-absent": ({"exports": {"import": "./a.mjs", "require": "./b.cjs", "default": "./d.js"}}, files("a.mjs", "b.cjs", "d.js"), []),
}
P["shared"] = ({"main": "index.js"}, {"index.js": cjs("hoisted copy")}, [])
for name in ("main-and-module", "module-only", "side-effects-false", "side-effects-false-esm"):
    del P[name]


def lay(folder, name, directory=None):
    pkg, files_, _ = P[name]
    d = os.path.join(folder, "node_modules", directory or "alr-" + name)
    for f, text in files_.items():
        os.makedirs(os.path.dirname(os.path.join(d, f)), exist_ok=True)
        open(os.path.join(d, f), "w").write(text)
    if pkg is not None:
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "package.json"), "w").write(json.dumps({"name": (directory or "alr-" + name), "version": "1.0.0", **pkg}, indent=2) + "\n")


INSIDE = 'function inside(p) { return String(p).split("node_modules/").pop(); }\n'
WAYS = {
    "require": ("cjs", 'try {\n  console.log(require("S").which);\n} catch (e) {\n  console.log(e.code);\n}\n'),
    "import-call": ("mjs", 'try {\n  console.log((await import("S")).which);\n} catch (e) {\n  console.log(e.code);\n}\n'),
    "require-resolve": ("cjs", INSIDE + 'try {\n  console.log(inside(require.resolve("S")));\n} catch (e) {\n  console.log(e.code);\n}\n'),
    "both": ("mjs", 'try {\n  console.log((await import("S")).which, require("S").which);\n} catch (e) {\n  console.log(e.code);\n}\n'),
}
count = 0
for name, (pkg, files_, subs) in P.items():
    specs = [("alr-" + name, None)] + [("alr-" + name + "/" + sub, None) for sub in subs]
    if name in ("exports-import-require", "main", "exports-pattern"):
        specs += [("@alr/" + name, "@alr/" + name)] + [("@alr/" + name + "/" + sub, "@alr/" + name) for sub in subs]
    for spec, directory in specs:
        for way, (ext, text) in WAYS.items():
            tag = spec.replace("@alr/", "scoped-").replace("alr-", "").replace("/", "--").replace(".", "-")
            folder = os.path.join(ROOT, f"{tag}-by-{way}")
            os.makedirs(folder, exist_ok=True)
            lay(folder, name, directory)
            if name in ("nested-dependency", "hoisted-dependency"):
                lay(folder, "shared")
            open(os.path.join(folder, "main." + ext), "w").write(text.replace('"S"', json.dumps(spec)))
            count += 1
print(count, "cases")
