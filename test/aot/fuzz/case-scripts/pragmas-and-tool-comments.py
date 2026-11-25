#!/usr/bin/env python3
"""pragmas-and-tool-comments.py <folder>: What stands at the head of published files, and inside them, for other tools changes
nothing: triple-slash references, @ts-check and kin, source map and source URL comments, Flow's comment types, hints for
linters, coverage tools, formatters and bundlers, JSX pragmas in files without JSX, directive prologues ("use client",
"use asm" ..), licence banners, conditional compilation of old tools, odd white space, a line of 70,000 bytes; at the top, on
the second line, behind a hashbang, in a function, between statements, at the end with and without a line end; hints inside
import(), require() and import statements and in front of calls; byte order marks, CRLF and CR. One file a case; other.js and
other.cjs go with the cases that name them. Left out: `<!--` and `// @bun` heads (`bun <file>` itself stops or takes the file
for something else), and in .ts files `-->`, U+2028 in a line comment and a reference to a file or lib that is not there:
there the checker stops the build, as tsc would.
"""
import itertools, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "other.js"), "w").write('export const v = "other";\nexport default "other default";\n')
open(os.path.join(OUT, "other.cjs"), "w").write('module.exports = { v: "other" };\n')
open(os.path.join(OUT, "types.d.ts"), "w").write("declare const alrDeclared: number;\n")
LINES = {
    "ref-path-missing": '/// <reference path="./nothing.d.ts" />', "ref-path-real": '/// <reference path="./types.d.ts" />', "ref-types-node": '/// <reference types="node" />', "ref-types-missing": '/// <reference types="not-installed" />', "ref-types-bun": '/// <reference types="bun-types" />', "ref-lib-dom": '/// <reference lib="dom" />', "ref-lib-odd": '/// <reference lib="es2099" />', "ref-no-default-lib": '/// <reference no-default-lib="true"/>',
    "amd-module": '/// <amd-module name="alr" />', "amd-dependency": '/// <amd-dependency path="x" />', "ref-broken": '/// <reference path=', "ts-check": "// @ts-check", "ts-nocheck": "// @ts-nocheck", "ts-ignore": "// @ts-ignore", "ts-expect-error": "// @ts-expect-error", "ts-check-block": "/* @ts-check */", "ts-nocheck-jsdoc": "/** @ts-nocheck */",
    "source-map-missing": "//# sourceMappingURL=nothing.js.map", "source-map-data": "//# sourceMappingURL=data:application/json;base64,e30=", "source-map-broken-data": "//# sourceMappingURL=data:application/json;base64,!!!", "source-map-old": "//@ sourceMappingURL=nothing.js.map", "source-map-block": "/*# sourceMappingURL=nothing.js.map */", "source-url": "//# sourceURL=alr://named.js", "source-url-odd": "//# sourceURL=../../../etc/passwd",
    "flow": "// @flow", "flow-strict": "/* @flow strict */", "flow-noflow": "// @noflow", "flow-types": "/*:: type T = { a: number }; */", "flow-import": '/*:: import type { T } from "./nothing"; */', "eslint-disable": "/* eslint-disable */", "eslint-env": "/* eslint-env node, browser */", "eslint-global": "/* global alrGlobal:writable, window */", "jshint": "/* jshint esversion: 6, node: true */", "jslint": "/*jslint node: true, vars: true */",
    "istanbul": "/* istanbul ignore next */", "c8": "/* c8 ignore start */", "v8-ignore": "/* v8 ignore next 3 */", "prettier-ignore": "// prettier-ignore", "biome-ignore": "// biome-ignore lint: reason", "deno-lint": "// deno-lint-ignore-file", "deno-types": '// @deno-types="./nothing.d.ts"', "jsx-h": "/** @jsx h */", "jsx-h-line": "// @jsx h", "jsx-frag": "/** @jsxFrag Fragment */", "jsx-runtime-classic": "/** @jsxRuntime classic */",
    "jsx-runtime-automatic": "/** @jsxRuntime automatic */", "jsx-import-source": "/** @jsxImportSource preact */", "jsx-import-source-missing": "/** @jsxImportSource not-installed */", "bun": "// @bun", "bun-cjs": "// @bun @bun-cjs", "bun-bytecode": "// @bun @bytecode", "bun-bytecode-cjs": "// @bun @bytecode @bun-cjs", "bun-odd": "// @bun @nothing", "bun-block": "/* @bun */", "bun-spaces": "//   @bun", "hashbang-node": "#!/usr/bin/env node", "hashbang-bun": "#!/usr/bin/env bun",
    "hashbang-flags": "#!/usr/bin/env -S node --experimental-vm-modules", "use-strict": '"use strict";', "use-strict-single": "'use strict'", "use-client": '"use client";', "use-server": '"use server";', "use-asm": '"use asm";', "use-strong": '"use strong";', "use-cache": '"use cache";', "use-no-memo": '"use no memo";', "use-odd": '"use \\x73trict";', "two-directives": '"use client";\n"use strict";', "licence": "/*! alr v1.0.0 | (c) 2026 | MIT */",
    "licence-jsdoc": "/**\n * @license MIT\n * @preserve\n * Copyright (c) 2026\n */", "licence-line": "//! licence", "cc-on": "/*@cc_on @*/", "cc-if": "/*@cc_on\n  @if (@_jscript)\n    hit();\n  @end\n@*/", "preprocess": "// #if DEBUG\n// #endif", "region": "//#region a\n//#endregion", "pure": "/*#__PURE__*/", "pure-at": "/* @__PURE__ */", "no-side-effects": "/*#__NO_SIDE_EFFECTS__*/", "inline": "/*#__INLINE__*/", "key": "/*@__KEY__*/", "mangle": "/*@__MANGLE_PROP__*/",
    "closure": "/** @fileoverview x\n * @suppress {checkTypes}\n * @nocollapse\n */", "closure-define": "/** @define {boolean} */", "vim": "// vim: set ts=2 sw=2:", "emacs": "// -*- mode: js; js-indent-level: 2 -*-", "html-open": "<!-- html comment", "html-close": "--> html close", "empty-block": "/**/", "stars": "/***/", "many-stars": "/*****\n ***** x\n *****/", "nested-open": "/* /* */", "line-in-block": "/* // */", "block-in-line": "// /*", "backslash-end": "// ends with a backslash \\",
    "unicode-ls": "// a\u2028globalThis.hit?.();", "unicode-ps": "/* a\u2029b */", "nbsp": "//\u00a0x", "zwnbsp-inside": "// \ufeff x", "emoji": "// 😀", "lone-surrogate-escape": '// \\ud800', "nul": "// a\\0b", "tab-vt-ff": "//\t\x0b\x0c x", "very-long": "// " + "x" * 70000,
}
BODY = {"js": 'globalThis.hit = () => console.log("A COMMENT RAN");\nconst a = 1;\nconsole.log(a, typeof hit);\n', "ts": 'const a: number = 1;\nconsole.log(a, "function");\n', "jsx": 'const a = 1;\nconsole.log(a, "function");\n'}
KINDS = {"js": "js", "mjs": "js", "cjs": "js", "ts": "ts"}
for k in [k for k in LINES if k == "html-open" or k.startswith("bun")]:
    del LINES[k]
REFUSED_IN_TYPESCRIPT = ("html-close", "unicode-ls", "ref-broken", "ref-lib-odd", "ref-path-missing")
n = 0


def put(name, text, raw=False):
    global n
    open(os.path.join(OUT, name), "wb").write(text if raw else text.encode("utf-8", "surrogatepass"))
    n += 1


for (k, line), (ext, kind) in itertools.product(LINES.items(), KINDS.items()):
    if kind == "ts" and k in REFUSED_IN_TYPESCRIPT:
        continue
    body = BODY[kind]
    put(f"{k}.first-{ext}.{ext}", line + "\n" + body)
    if not k.startswith("hashbang"):
        put(f"{k}.second-{ext}.{ext}", "// a comment first\n" + line + "\n" + body)
        put(f"{k}.last-{ext}.{ext}", body + line + "\n")
        put(f"{k}.last-no-newline-{ext}.{ext}", body + line)
        if ext in ("js", "ts"):
            put(f"{k}.after-hashbang-{ext}.{ext}", "#!/usr/bin/env bun\n" + line + "\n" + body)
            put(f"{k}.in-function-{ext}.{ext}", "function f() {\n" + line + "\n  return 1;\n}\n" + body.replace("console.log(a,", "console.log(a, f(),"))
            put(f"{k}.between-{ext}.{ext}", body.replace("\nconsole", "\n" + line + "\nconsole", 1))
# hints inside import() and require(), in front of calls and classes
HINTS = ["/* webpackChunkName: \"x\" */", "/* webpackIgnore: true */", "/* @vite-ignore */", "/* webpackMode: \"eager\" */", "/* webpackPrefetch: true */", "/* turbopackIgnore: true */", "/* @bun-ignore */", "/*#__PURE__*/", "/** @type {any} */", "/** @import inside */", "// line\n"]
for i, h in enumerate(HINTS):
    put(f"hint-{i}.import-call.mjs", f'const m = await import({h} "./other.js");\nconsole.log(m.v);\n')
    put(f"hint-{i}.import-call-after.mjs", f'const m = await import("./other.js" {h});\nconsole.log(m.v);\n')
    put(f"hint-{i}.require.cjs", f'const m = require({h} "./other.cjs");\nconsole.log(m.v);\n')
    put(f"hint-{i}.import-from.mjs", f'import {h} d, {h} {{ {h} v {h} }} {h} from {h} "./other.js" {h};\nconsole.log(d, v);\n')
    put(f"hint-{i}.call.js", f"function f() {{\n  console.log(\"called\");\n  return 1;\n}}\nconst a = {h} f();\n{h} f();\nconsole.log(a);\n")
    put(f"hint-{i}.new.js", f"class K {{\n  constructor() {{\n    console.log(\"made\");\n  }}\n}}\nconst a = {h} new K();\n{h} new K();\nconsole.log(typeof a);\n")
    put(f"hint-{i}.iife.js", f"const a = {h} (() => {{\n  console.log(\"ran\");\n  return 1;\n}})();\n{h} (function () {{\n  console.log(\"ran too\");\n}})();\nconsole.log(a);\n")
# byte order marks and line ends
for ext, kind in KINDS.items():
    b = BODY[kind].encode()
    put(f"bom.first-{ext}.{ext}", b"\xef\xbb\xbf" + b, True)
    put(f"bom.then-hashbang-{ext}.{ext}", b"\xef\xbb\xbf#!/usr/bin/env bun\n" + b, True)
    put(f"bom.then-directive-{ext}.{ext}", b"\xef\xbb\xbf\"use strict\";\n" + b, True)
    put(f"crlf.all-{ext}.{ext}", b"// c\r\n\"use strict\";\r\n" + b.replace(b"\n", b"\r\n"), True)
    put(f"cr.all-{ext}.{ext}", b"// c\r" + b.replace(b"\n", b"\r"), True)
    put(f"crlf.hashbang-{ext}.{ext}", b"#!/usr/bin/env bun\r\n" + b.replace(b"\n", b"\r\n"), True)
    put(f"no-final-newline-{ext}.{ext}", b.rstrip(b"\n"), True)
    put(f"many-blank-lines-{ext}.{ext}", b"\n" * 5000 + b, True)
