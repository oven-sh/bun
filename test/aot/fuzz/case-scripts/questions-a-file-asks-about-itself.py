#!/usr/bin/env python3
"""questions-a-file-asks-about-itself.py <folder>: What a file can ask about itself (module, require.main,
process.mainModule, exports, arguments, __filename, Bun.main, import.meta): two questions a program, or a store and then
a question. Each question is right alone; what the build makes of a module object depends on everything the file does
with it. One file a case. Nothing is printed that differs between `bun <file>` and an executable by design: no folders,
no listing of require.cache, no `import.meta.main` behind a store.
"""
import itertools, os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
HELP = {
    "base": 'function base(p) { return String(p).split("/").pop(); }',
    "keep": "function keep(v) { return typeof v; }",
    "change": 'function change(m) { m.id = "by a helper"; m.filename = "/helped.cjs"; }',
    "alter": 'function alter(m) { m.url = "file:///helped.mjs"; m.custom = 2; }',
}


def write(name, ext, text):
    text = "".join(HELP[h] + "\n" for h in HELP if re.search(r"\b" + h + r"\(", text)) + text
    open(os.path.join(sys.argv[1], f"{name}.{ext}"), "w").write(text)


WHOLE = {
    "in-a-list": "[module].length", "handed": "keep(module)", "compared": "module === 1", "its-class": "module.constructor.name", "in": '"filename" in module', "keys": "Object.keys(module).join()",
    "names": "Object.getOwnPropertyNames(module).length", "pattern": "(({ filename, id }) => typeof filename + typeof id)(module)", "instanceof": 'module instanceof require("node:module")',
    "arguments-length": "arguments.length", "arguments-module": "arguments[2] === module", "arguments-exports": "arguments[0] === exports",
}
READ = {
    "main-filename": "typeof require.main.filename", "main-optional": "typeof require.main?.filename", "main-base": "base(require.main.filename)", "main-id": "require.main.id", "main-path": "typeof require.main.path", "main-loaded": "require.main.loaded",
    "main-file-is-own": "require.main.filename === __filename", "bun-main-is-mains": "Bun.main === require.main.filename", "main-is-module": "require.main === module", "main-undefined": "require.main === undefined", "main-keys": "Object.keys(require.main).join()",
    "process-main-base": "base(process.mainModule.filename)", "process-main-is-main": "process.mainModule === require.main", "created-main": 'typeof require("node:module").createRequire(__filename).main', "module-id": "module.id", "module-base": "base(module.filename)",
    "module-children": "module.children.length", "module-parent": "typeof module.parent", "exports-is-modules": "exports === module.exports",
}
count = 0
for (w, whole), (r, read) in itertools.product(WHOLE.items(), READ.items()):
    write(f"beside-{w}-{r}", "cjs", f"console.log(String({whole}), String({read}));\n")
    write(f"behind-{w}-{r}", "cjs", f"console.log(String({whole}));\nconsole.log(String({read}));\n")
    count += 2
STORE = {
    "module-id": 'module.id = "changed";', "module-filename": 'module.filename = "/changed/name.cjs";', "module-loaded": "module.loaded = 5;", "module-custom": "module.custom = 1;", "module-children": "module.children = [1, 2, 3];", "module-parent": "module.parent = 7;", "delete-id": "delete module.id;",
    "delete-filename": "delete module.filename;", "delete-exports": "delete module.exports;", "define-id": 'Object.defineProperty(module, "id", { get() { return "got"; } });', "freeze": "Object.freeze(module);", "assign": 'Object.assign(module, { id: "assigned", filename: "/assigned.cjs" });',
    "computed": 'module[["i", "d"].join("")] = "computed";', "by-a-helper": "change(module);", "through-main": 'require.main.id = "through main";', "through-process-main": 'process.mainModule.id = "through process";', "through-arguments": 'arguments[2].id = "through arguments";',
    "exports-new": "module.exports = { fresh: 1 };", "exports-null": "module.exports = null;", "module-stored-to": 'module = { id: "local", exports: {}, filename: "/local.cjs", children: [], loaded: 0 };', "require-stored-to": "require = Object.assign(() => 7, { main: undefined });",
    "filename-stored-to": '__filename = "/local/name.cjs";', "arguments-stored-to": "arguments[2] = 5;", "main-stored-to": "require.main = 5;", "stored-in-a-function": "function later() { module = 1; }\nlater();",
}
for (s, store), (r, read) in itertools.product(STORE.items(), READ.items()):
    write(f"store-{s}-{r}", "cjs", f"{store}\ntry {{\n  console.log(String({read}));\n}} catch (e) {{\n  console.log(e.constructor.name);\n}}\n")
    count += 1
M = "import.meta"
META_STORE = {
    "url": f'{M}.url = "file:///changed.mjs";', "path": f'{M}.path = "/changed.mjs";', "dir": f'{M}.dir = "/changed";', "file": f'{M}.file = "changed.mjs";', "env": f"{M}.env = {{ A: 1 }};", "resolve": f"{M}.resolve = () => 7;", "custom": f"{M}.custom = 1;", "delete-url": f"delete {M}.url;",
    "delete-path": f"delete {M}.path;", "define-url": f'Object.defineProperty({M}, "url", {{ get() {{ return "file:///got.mjs"; }} }});', "assign": f'Object.assign({M}, {{ url: "file:///assigned.mjs", path: "/assigned.mjs" }});', "by-a-helper": f"alter({M});", "freeze": f"Object.freeze({M});",
    "reflect": f'Reflect.set({M}, "url", "file:///reflected.mjs");', "second-name": f'const meta = {M};\nmeta.url = "file:///second.mjs";', "new-prototype": f"Object.setPrototypeOf({M}, {{ inherited: 1 }});", "null-prototype": f"Object.setPrototypeOf({M}, null);", "nothing": "",
}
META_READ = {
    "url": f"base({M}.url)", "path": f"base({M}.path)", "file": f"{M}.file", "dirname-is-dir": f"{M}.dirname === {M}.dir", "filename-is-path": f"{M}.filename === {M}.path", "typeof-env": f"typeof {M}.env", "typeof-resolve": f"typeof {M}.resolve", "resolve-call": f'typeof {M}.resolve("./x.mjs")',
    "resolve-sync-call": f'typeof {M}.resolveSync("node:path")', "require-call": f'typeof {M}.require("node:path")', "keys": f"Object.keys({M}).sort().join()", "custom": f"{M}.custom", "in-url": f'"url" in {M}', "computed-url": f'base({M}[["ur", "l"].join("")])', "new-url": f'base(new URL("./x.txt", {M}.url).href)',
    "inherited": f"{M}.inherited", "frozen": f"Object.isFrozen({M})", "bun-main-is-path": f"Bun.main === {M}.path",
}
for (s, store), (r, read) in itertools.product(META_STORE.items(), META_READ.items()):
    write(f"meta-{s}-{r}", "mjs", (store + "\n" if store else "") + f"try {{\n  console.log(String({read}));\n}} catch (e) {{\n  console.log(e.constructor.name);\n}}\n")
    count += 1
print(count, "cases")
