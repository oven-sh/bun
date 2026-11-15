#!/usr/bin/env python3
"""object-ops-in-const-initializer.py <folder>: The initializer of a top-level constant allocates an object and does one
thing to it: a store, a definition, a deletion, a call. Setters, getters and locked objects on the prototype chain
log what happens. Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
P = 'console.log("ran")'
front = f"""const given = JSON.parse('{{ "off": false }}');
process.on("uncaughtException", error => {{ console.log("uncaught", error.name); process.exit(0); }});
const above = {{ set a(v) {{ {P}; }}, get b() {{ {P}; return 1; }}, get c() {{ return 1; }} }};
const lockedAbove = Object.freeze({{ a: 1, b: 2, c: 3, 0: 1 }});
class Base {{ static set a(v) {{ {P}; }} static get c() {{ return 1; }} set a(v) {{ {P}; }} get c() {{ return 1; }} }}
function Plain() {{}}
Plain.prototype = {{ set a(v) {{ {P}; }}, get c() {{ return 1; }} }};
"""
kinds = {
 "a-literal": "{ z: 1 }",
 "a-literal-with-the-member": "{ a: 1, b: 2, c: 3 }",
 "a-literal-with-accessors": "{ set a(v) { %s; }, get b() { %s; return 1; }, get c() { return 1; } }" % (P, P),
 "a-literal-below-accessors": "{ __proto__: above, z: 1 }",
 "a-literal-below-a-locked-object": "{ __proto__: lockedAbove, z: 1 }",
 "a-literal-below-a-fresh-literal": "{ __proto__: { set a(v) { %s; }, get c() { return 1; } }, z: 1 }" % P,
 "a-literal-below-null": "{ __proto__: null, z: 1 }",
 "a-literal-with-a-spread": "{ ...above, z: 1 }",
 "a-literal-with-a-computed-key": "{ [given.off ? 'a' : 'c']: 1 }",
 "a-list": "[1, 2]",
 "an-empty-list": "[]",
 "a-list-with-a-hole": "[1, , 3]",
 "a-function": "function () {}",
 "an-arrow": "() => 1",
 "a-method": "({ m() {} }).m",
 "a-generator-function": "function* () {}",
 "an-async-function": "async function () {}",
 "a-class": "class {}",
 "a-class-with-static-accessors": "class { static set a(v) { %s; } static get c() { return 1; } }" % P,
 "a-class-below-static-accessors": "class extends Base {}",
 "a-class-with-a-static-method": "class { static a() {} static c() {} }",
 "an-instance": "new (class { z = 1; })()",
 "an-instance-with-accessors": "new Base()",
 "an-instance-below-accessors": "new (class extends Base {})()",
 "an-instance-of-a-function": "new Plain()",
 "an-instance-locked-in-its-constructor": "new (class { a = 1; c = 1; constructor() { Object.freeze(this); } })()",
 "a-regexp": "/a/g",
 "a-rest-list": "((...rest) => rest)(1, 2)",
 "an-arguments-object": "(function () { return arguments; })(1, 2)",
 "a-strict-arguments-object": "(function () { 'use strict'; return arguments; })(1, 2)",
 "a-generator": "(function* () {})()",
 "a-template-object": "(strings => strings)`a`",
 "a-promise": "new Promise(() => {})",
 "a-map": "new Map()",
 "a-bound-function": "(function () {}).bind(null)",
 "a-text-object": "Object('ab')",
}
operations = {
 "store-a": "m.a = 1;", "store-c": "m.c = 1;", "store-index": "m[0] = 9;", "store-key": "m[given.off ? 'z' : 'c'] = 1;", "store-far-index": "m[5] = 1;",
 "store-proto-number": "m.__proto__ = 1;", "store-proto-itself": "m.__proto__ = m;", "store-proto-accessors": "m.__proto__ = above; m.a = 1;",
 "store-length": "m.length = -1;", "store-length-zero": "m.length = 0;", "store-name": "m.name = 'n';", "store-prototype": "m.prototype = 1;", "store-constructor": "m.constructor = 1;",
 "store-source": "m.source = 1;", "store-last-index": "m.lastIndex = 1;", "store-tag": "m[Symbol.toStringTag] = 1;", "store-has-instance": "m[Symbol.hasInstance] = 1;", "store-callee": "m.callee = 1;", "store-raw": "m.raw = 1;",
 "read-b": "m.b;", "read-caller": "m.caller;", "read-arguments": "m.arguments;", "read-callee": "m.callee;", "read-a-of-a": "m.a.a;",
 "delete-a": "delete m.a;", "delete-length": "delete m.length;", "delete-prototype": "delete m.prototype;", "delete-index": "delete m[0];", "delete-name": "delete m.name;",
 "in": "'a' in m;", "call-a": "m.a();", "call": "m();", "new": "new m();", "spread": "[...m];", "pattern": "const [first] = m;", "template": "`${m}`;", "add": "m + 1;", "instanceof": "({}) instanceof m;", "extends": "(class extends m {});",
 "increment-a": "m.a++;", "assign-or": "m.c ||= 2;", "assign-add": "m.c += 1;",
}
tails = { "never-read": 'if (given.off) console.log(use());\nconsole.log("returned");', "read-late": 'console.log("between"); console.log(typeof use()); console.log("returned");' }
n = 0
for kind, made in kinds.items():
    for name, operation in operations.items():
        for place, tail in tails.items():
            open(f"{out}/{kind}--{name}--{place}.mjs", "w").write(f"{front}function make() {{ const m = {made}; {operation} return [m, {{ a: [1, 2, 3], b: {{ c: 1 }} }}]; }}\nconst held = make();\nfunction use() {{ return held; }}\n{tail}\n"); n += 1
        # the same with the operation in a helper
        open(f"{out}/{kind}--{name}--in-a-helper.mjs", "w").write(f"{front}function act(m) {{ {operation} }}\nfunction make() {{ const m = {made}; act(m); return [m, {{ a: [1, 2, 3], b: {{ c: 1 }} }}]; }}\nconst held = make();\nfunction use() {{ return held; }}\n{tails['never-read']}\n"); n += 1
print(n)
