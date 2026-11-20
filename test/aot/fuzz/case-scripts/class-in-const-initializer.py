#!/usr/bin/env python3
"""class-in-const-initializer.py <folder>: The initializer of a top-level constant defines a class whose `extends`
clause and computed keys may throw or run code. Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
H = "const given = JSON.parse('{ \"off\": false }');\nprocess.on(\"uncaughtException\", error => { console.log(\"uncaught\", error.name); process.exit(0); });\n"
T = 'const held = make();\nfunction use() { return held; }\nif (given.off) console.log(use());\nconsole.log("returned");\n'
heritages = ["Proxy", "Symbol", "BigInt", "Function.prototype", "Math.max", "Date.now", "Reflect", "JSON", "globalThis", "Intl.Collator", "Buffer", "Promise.resolve", "Object", "Array", "Error", "Map", "Promise", "RegExp", "Function", "Uint8Array", "Object.getPrototypeOf(Uint8Array)", "Object.getPrototypeOf(function* () {})", "Object.getPrototypeOf(async function () {}).constructor", "null", "undefined", "(() => 1)", "(function () {}).bind(null)", "(class {}).bind(null)", "new Proxy(class {}, {})", "EventTarget", "Event", "URL", "TextDecoder", "AbortController", "Blob", "Response", "WeakRef", "Date", "Boolean", "Number", "String", "ArrayBuffer", "DataView", "Iterator", "parseInt", "eval", "console.log", "queueMicrotask", "structuredClone", "setTimeout", "Bun.file", "process.nextTick"]
bodies = {
  "defined": "function make() { return [class extends HERITAGE {}, { a: [1, 2, 3] }]; }",
  "defined-with-members": "function make() { return [class extends HERITAGE { m() {} static s() {} get g() { return 1; } }, { a: [1, 2, 3] }]; }",
  "constructed": "function make() { const C = class extends HERITAGE {}; return [new C(), { a: [1, 2, 3] }]; }",
  "through-a-constant": "const Above = HERITAGE;\nfunction make() { return [class extends Above {}, { a: [1, 2, 3] }]; }",
}
n = 0
for i, heritage in enumerate(heritages):
    for name, body in bodies.items():
        open(f"{out}/heritage-{i:02d}--{name}.mjs", "w").write(H + body.replace("HERITAGE", heritage) + "\n" + T); n += 1
keys = ['"prototype"', '"constructor"', '"name"', '"length"', '"caller"', '"arguments"', '"__proto__"', "Symbol.hasInstance", "Symbol.species", "0", "1n", "null", "undefined", "true", "Symbol()", "`proto${'type'}`", "given.off ? 'a' : 'prototype'", "['prototype']", "{ toString() { return 'prototype'; } }", "String('prototype')"]
members = { "static-method": "static [KEY]() {}", "static-getter": "static get [KEY]() { return 1; }", "static-setter": "static set [KEY](v) {}", "static-field": "static [KEY] = 1;", "method": "[KEY]() {}", "field": "[KEY] = 1;", "static-generator": "static *[KEY]() {}", "static-async": "static async [KEY]() {}", "two-static": "static [KEY]() {} static [KEY]() {}", "static-field-behind-a-method": "static [KEY]() {} static [KEY] = 1;" }
for i, key in enumerate(keys):
    for name, member in members.items():
        open(f"{out}/key-{i:02d}--{name}.mjs", "w").write(H + f"function make() {{ return [class {{ {member.replace('KEY', key)} }}, {{ a: [1, 2, 3] }}]; }}\n" + T); n += 1
        open(f"{out}/key-{i:02d}--{name}--through-a-constant.mjs", "w").write(H + f"const key = {key};\nfunction make() {{ return [class {{ {member.replace('KEY', 'key')} }}, {{ a: [1, 2, 3] }}]; }}\n" + T); n += 1
print(n)
