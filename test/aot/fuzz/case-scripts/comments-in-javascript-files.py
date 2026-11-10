#!/usr/bin/env python3
"""comments-in-javascript-files.py <folder>: A comment changes nothing. The checker reads JSDoc in JavaScript files, and what
it made of a comment once reached the build: `/** @import inside (@media) */` in front of a function was compiled as code
(`ReferenceError: media is not defined`, and `(@hit())` called hit()), which killed `require("less")`; and
`@callback lunr.Token~updateFunction` in a comment inside a function stopped the build of lunr with TS1235. The tags that the
checker parses x what real packages write behind a tag (namepaths, Closure types, unbalanced braces, e-mail addresses, CSS
at-rules, decorators in examples, imports of files that exist and do not), in front of a function; every other tag x the
texts that bit; and the pairs that bit x where the comment stands x .js, .mjs, .cjs. One file a case; real.js, real.cjs and
types.d.ts go with the cases that name them, and real.js and real.cjs print when they run: a comment must not run them.
"""
import itertools, json, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "real.js"), "w").write('console.log("real.js runs");\nexport const A = 1;\nexport default 2;\n')
open(os.path.join(OUT, "real.cjs"), "w").write('console.log("real.cjs runs");\nexports.A = 1;\n')
open(os.path.join(OUT, "types.d.ts"), "w").write("export type T = number;\nexport interface I { a: number }\n")
TAGS = """import type typedef callback param returns return template extends augments implements enum this class constructor public private protected readonly override satisfies overload deprecated see link throws exception author example default
module namespace memberof function func method name property prop arg argument yields async generator export exports requires license since version todo summary description fileoverview file kind static instance inner global mixin mixes
listens fires emits event access abstract virtual borrows alias lends variation ignore hideconstructor interface external host copyright tutorial inheritdoc package internal experimental beta alpha remarks typeParam defaultValue ts-ignore ts-nocheck ts-expect-error jsx jsxImportSource jsxFrag""".split()
TEXTS = {
    "nothing": "", "word": "thing", "namepath-tilde": "lunr.Token~updateFunction", "namepath-hash": "Foo#bar", "namepath-dot": "a.b.c", "namepath-module": "module:foo/bar~Baz", "namepath-event": "Foo#event:bar", "type-object": "{Object} lunr.Index~Result", "type-string-name": "{string} name - the name", "type-closure-map": "{Object.<string, number>} map", "type-closure-list": "{Array.<{a: number}>} list",
    "type-nullable": "{?string} s", "type-non-null": "{!Array} a", "type-rest": "{...number} n", "type-optional": "{number=} n", "type-optional-name": "{number} [n=1] n", "type-function": "{function(string, number): void} cb", "type-function-new": "{function(new:Foo, string)} c", "type-star": "{*} x", "type-question": "{?} x", "type-union": "{(string|number)} x", "type-union-bare": "{string|number|null} x", "type-record": "{{a: number, b: string}} r",
    "type-generic": "{Promise<Array<string>>} p", "type-import-missing": '{import("./nothing").T} x', "type-import-real": '{import("./types").T} x', "type-import-code": '{import("./real.js").A} x', "type-typeof-import": '{typeof import("node:fs")} fs', "type-typeof": "{typeof f} g", "type-keyof": "{keyof typeof f} k", "type-unknown-name": "{NoSuchType} x", "type-tuple": "{[number, string]} t", "type-literal": '{"a"|"b"} s', "type-arrow": "{(a: number) => string} f",
    "type-conditional": "{T extends string ? 1 : 2} c", "type-template": "{`a${string}`} s", "brace-open": "{", "brace-open-text": "{string", "brace-double-open": "{{a: 1}", "brace-close": "}", "brace-empty": "{}", "angle": "<T>", "angle-open": "<T", "arrow": "=> x", "backtick": "`code`", "backtick-open": "`", "quote-open": '"text', "email": "Jane Doe <jane@example.com>", "email-bare": "jane@example.com", "at-alone": "@", "at-number": "@1", "at-dash": "@-rules",
    "at-media": "inside (@media)", "at-media-list": "inside @-rules (@media, @supports, etc.): Processed", "at-call": "inside (@hit())", "at-call-bare": "@hit()", "at-member": "(@a.b.c)", "at-component": '@Component({ selector: "x" })', "css-import": '"foo.css";', "css-import-url": "url(foo.css);", "import-named": '{ A } from "./real.js"', "import-default": 'x from "./real.js"', "import-star": '* as x from "./real.js"', "import-both": 'x, { A } from "./real.js"',
    "import-cjs": '{ A } from "./real.cjs"', "import-missing": '{ A } from "./nothing.js"', "import-package-missing": '{ A } from "not-installed"', "import-types": '{ T } from "./types"', "import-node": '{ Stats } from "node:fs"', "import-side": '"./real.js"', "import-with": '{ A } from "./real.js" with { type: "json" }', "import-no-from": "{ A }", "import-unclosed": '{ A from "./real.js"', "code-statement": "hit();", "code-block": "{ hit(); }", "code-fence": "```js\\n * hit();\\n * ```",
    "html": "<b>bold</b> <script>hit()</script>", "url": "https://example.com/a?b=c#d", "link-inline": "{@link Foo#bar} and {@link https://x.y|text}", "star-slash-like": "* /", "unicode": "é 日本 😀", "long": "x" * 3000, "many-tags": "@a @b @c @d", "newline-tag": "x\\n * @import inside (@media)", "equals": "= 1", "brackets": "[a, b]", "paren-open": "(", "semicolon": ";", "dollar": "${hit()}", "hash-bang": "#!x", "less-than-bang": "<!-- x -->",
}
HEAD = 'globalThis.hit = () => {\n  console.log("CODE IN A COMMENT RAN");\n  return () => {};\n};\n'
n = 0


def put(name, text):
    global n
    open(os.path.join(OUT, name), "w").write(text)
    n += 1


def comment(tag, text):
    body = f"@{tag} {text}".rstrip().replace("\\n", "\n")
    return f"/** {body} */" if "\n" not in body else "/**\n * " + body + "\n */"


PARSED = "import type typedef callback param returns template extends implements enum this satisfies overload see link throws property".split()
BIT = "at-media at-call namepath-tilde type-object newline-tag email-bare link-inline namepath-hash dollar type-generic brace-open-text import-named".split()
for tag, (k, text) in itertools.product(TAGS, TEXTS.items()):
    if tag in PARSED or k in BIT:
        put(f"{tag}.{k}.before-function.js", HEAD + comment(tag, text) + "\nfunction f(x) {\n  return 1;\n}\nconsole.log(f());\n")
PLACES = {
    "file-top": "C\nconsole.log(1);\n", "file-end": "console.log(1);\nC\n", "only": "C\n", "before-const": "C\nconst a = 1;\nconsole.log(a);\n", "before-let": "C\nlet a = 1;\nconsole.log(a);\n", "before-class": "C\nclass K {}\nconsole.log(typeof K);\n", "before-method": "class K {\n  C\n  m() {\n    return 1;\n  }\n}\nconsole.log(new K().m());\n", "before-field": "class K {\n  C\n  x = 1;\n}\nconsole.log(new K().x);\n",
    "before-property": "const o = {\n  C\n  a: 1,\n};\nconsole.log(o.a);\n", "before-statement": "let a = 0;\nC\na = 1;\nconsole.log(a);\n", "before-call": "C\nconsole.log(1);\n", "before-return": "function f() {\n  C\n  return 1;\n}\nconsole.log(f());\n", "before-import": 'C\nimport { sep } from "node:path";\nconsole.log(typeof sep);\n', "before-export": "C\nexport const a = 1;\nconsole.log(a);\n", "before-export-default": "C\nexport default function f() {}\nconsole.log(1);\n",
    "before-arrow": "C\nconst f = () => 1;\nconsole.log(f());\n", "before-parameter": "function f(C x) {\n  return 1;\n}\nconsole.log(f());\n", "inside-expression": "const a = C (1);\nconsole.log(a);\n", "cast": "const a = C (JSON.parse(\"1\"));\nconsole.log(a);\n", "in-a-block": "{\n  C\n  const a = 1;\n  console.log(a);\n}\n", "before-if": "C\nif (true) console.log(1);\n", "before-for": "C\nfor (let i = 0; i < 1; i++) console.log(1);\n", "trailing": "const a = 1; C\nconsole.log(a);\n",
    "two-comments": "C\nC\nfunction f() {\n  return 1;\n}\nconsole.log(f());\n", "before-module-exports": "C\nmodule.exports = { a: 1 };\nconsole.log(1);\n", "before-prototype": "function K() {}\nC\nK.prototype.m = function () {\n  return 1;\n};\nconsole.log(new K().m());\n", "before-this-member": "function K() {\n  C\n  this.x = 1;\n}\nconsole.log(new K().x);\n",
}
SHARP = [("import", "at-media"), ("import", "at-call"), ("import", "import-named"), ("import", "import-default"), ("import", "import-side"), ("import", "import-missing"), ("import", "css-import"), ("import", "word"), ("callback", "namepath-tilde"), ("typedef", "type-object"), ("typedef", "namepath-tilde"), ("type", "type-unknown-name"), ("type", "brace-open-text"), ("type", "type-import-missing"), ("type", "type-import-code"), ("param", "type-closure-map"),
         ("template", "word"), ("extends", "type-unknown-name"), ("enum", "type-string-name"), ("this", "type-unknown-name"), ("satisfies", "type-unknown-name"), ("overload", "nothing"), ("example", "at-component"), ("example", "at-call-bare"), ("author", "email"), ("see", "link-inline"), ("class", "nothing"), ("constructor", "nothing"), ("ts-nocheck", "nothing"), ("jsx", "word"), ("jsxImportSource", "word")]
for (tag, k), (p, place), ext in itertools.product(SHARP, PLACES.items(), ("js", "mjs", "cjs")):
    if ext == "cjs" and ("import {" in place or "export " in place) or ext == "mjs" and "module.exports" in place:
        continue
    put(f"{tag}.{k}.{p}-{ext}.{ext}", HEAD + place.replace("C", comment(tag, TEXTS[k])))
