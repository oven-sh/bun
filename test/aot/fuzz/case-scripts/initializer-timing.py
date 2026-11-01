#!/usr/bin/env python3
"""initializer-timing.py <folder>: The initializer of a top-level constant reads something that changes between the
declaration and the constant's first read. Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
G = "const given = JSON.parse('{ \"off\": false, \"one\": 1 }');\n"
# name: (in front, expression read inside make(), what changes it behind the statement)
R = {
 "a-field": ("const source = { v: 1 };", "source.v", "source.v = 2;"),
 "a-field-two-deep": ("const source = { in: { v: 1 } };", "source.in.v", "source.in.v = 2;"),
 "a-field-replaced-object": ("const source = { in: { v: 1 } };", "source.in.v", "source.in = { v: 2 };"),
 "a-field-added-late": ("const source = {};", "source.v", "source.v = 2;"),
 "a-field-deleted-late": ("const source = { v: 1 };", "source.v", "delete source.v;"),
 "a-field-made-an-accessor": ("const source = { v: 1 };", "source.v", "Object.defineProperty(source, 'v', { get() { return 2; } });"),
 "a-field-found-above": ("const above = { v: 1 }; const source = { __proto__: above };", "source.v", "above.v = 2;"),
 "a-field-hidden-late": ("const above = { v: 1 }; const source = { __proto__: above };", "source.v", "source.v = 2;"),
 "another-prototype-late": ("const source = { __proto__: { v: 1 } };", "source.v", "Object.setPrototypeOf(source, { v: 2 });"),
 "an-element": ("const source = [1];", "source[0]", "source[0] = 2;"),
 "a-length": ("const source = [1];", "source.length", "source.push(2);"),
 "a-let": ("let source = 1;", "source", "source = 2;"),
 "a-let-changed-by-a-function": ("let source = 1; function change() { source = 2; }", "source", "change();"),
 "a-var-set-late": ("var source;", "source", "source = 2;"),
 "a-captured-variable": ("const cell = (() => { let v = 1; return { get: () => v, set: n => { v = n; } }; })();", "cell.get()", "cell.set(2);"),
 "a-static-field": ("class Source { static v = 1; }", "Source.v", "Source.v = 2;"),
 "a-method-replaced": ("class Source { m() { return 1; } } const source = new Source();", "source.m()", "Source.prototype.m = () => 2;"),
 "a-function-member": ("function source() {} source.v = 1;", "source.v", "source.v = 2;"),
 "a-function-prototype": ("function Source() {} Source.prototype.v = 1;", "new Source().v", "Source.prototype = { v: 2 };"),
 "a-function-prototype-member": ("function Source() {} Source.prototype.v = 1;", "new Source().v", "Source.prototype.v = 2;"),
 "a-global": ("globalThis.sourceOfTime = 1;", "globalThis.sourceOfTime", "globalThis.sourceOfTime = 2;"),
 "a-global-by-name": ("globalThis.sourceOfTime = 1;", "sourceOfTime", "sourceOfTime = 2;"),
 "an-environment-variable": ("process.env.SOURCE_OF_TIME = '1';", "process.env.SOURCE_OF_TIME", "process.env.SOURCE_OF_TIME = '2';"),
 "own-keys": ("const source = { a: 1 };", "Object.keys(source).length", "source.b = 2;"),
 "in": ("const source = {};", "'v' in source", "source.v = 2;"),
 "a-map": ("const source = new Map([[1, 1]]);", "source.get(1)", "source.set(1, 2);"),
 "a-set-size": ("const source = new Set([1]);", "source.size", "source.add(2);"),
 "a-typed-array": ("const source = new Uint8Array([1]);", "source[0]", "source[0] = 2;"),
 "a-regexp-last-index": ("const source = /a/g;", "source.lastIndex", "source.lastIndex = 2;"),
 "a-counter": ("let count = 0;", "++count", "++count;"),
 "a-spread": ("const source = { v: 1 };", "({ ...source }).v", "source.v = 2;"),
 "a-list-spread": ("const source = [1];", "[...source][0]", "source[0] = 2;"),
 "a-pattern": ("const source = { v: 1 };", "(({ v }) => v)(source)", "source.v = 2;"),
 "json": ("const source = { v: 1 };", "JSON.stringify(source)", "source.v = 2;"),
 "a-template": ("const source = { v: 1 };", "`${source.v}`", "source.v = 2;"),
 "is-frozen": ("const source = { v: 1 };", "Object.isFrozen(source)", "Object.freeze(source);"),
 "is-extensible": ("const source = { v: 1 };", "Object.isExtensible(source)", "Object.preventExtensions(source);"),
 "prototype-of": ("const source = {};", "Object.getPrototypeOf(source) === Object.prototype", "Object.setPrototypeOf(source, null);"),
 "instanceof": ("function Source() {} const made = new Source();", "made instanceof Source", "Source.prototype = {};"),
 "name-of-a-function": ("const source = function () {};", "source.name", "Object.defineProperty(source, 'name', { value: 'late' });"),
 "a-parsed-object": ("", "given.one", "given.one = 2;"),
 "the-stack": ("", "new Error().stack.split('\\n').length > 3", ""),
 "another-constant-put-off": ("const source = { v: 1 }; function other() { return { v: source.v, l: [1, 2, 3], m: { a: 1 } }; } const first = other(); function readFirst() { return first; }", "readFirst().v", "source.v = 2;"),
 "a-const-object-never-changed-here-but-through-an-alias": ("const source = { v: 1 }; const alias = [source];", "source.v", "alias[0].v = 2;"),
 "a-const-object-changed-by-a-callee-of-native-code": ("const source = { v: 1 };", "source.v", "[1].forEach(() => { source.v = 2; });"),
 "a-const-object-changed-under-a-key": ("const source = { v: 1 };", "source.v", "source[given.off ? 'w' : 'v'] = 2;"),
 "a-const-object-changed-by-assign": ("const source = { v: 1 };", "source.v", "Object.assign(source, { v: 2 });"),
 "a-const-object-changed-by-reflect": ("const source = { v: 1 };", "source.v", "Reflect.set(source, 'v', 2);"),
}
n = 0
for name, (front, read, change) in R.items():
    for place, maker in (("straight", f"function make() {{ return {{ v: {read}, l: [1, 2, 3], m: {{ a: 1 }} }}; }}"),
                         ("in-a-helper", f"function look() {{ return {read}; }}\nfunction make() {{ return {{ v: look(), l: [1, 2, 3], m: {{ a: 1 }} }}; }}"),
                         ("in-a-method-of-a-literal", f"function make() {{ return {{ v: ({{ look() {{ return {read}; }} }}).look(), l: [1, 2, 3], m: {{ a: 1 }} }}; }}")):
        open(f"{out}/{name}--{place}.mjs", "w").write(f"{G}{front}\n{maker}\nconst held = make();\nfunction use() {{ return held; }}\n{change}\nconsole.log(use().v, use() === use());\n"); n += 1
print(n)
