#!/usr/bin/env python3
"""effects-in-deferred-initializer.py <folder>: An operation that throws, prints or suspends for some inputs is in the
initializer of a top-level constant; the constant is never read, read late, or read by a function that may not run.
Writes one file per case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
P = 'console.log("ran")'
# name: (operation on x, the other value of x, [what arrives], text in front of everything)
O = {
 "read-member": ("x.member;", "{ member: 1 }", ["null", "undefined", "{ get member() { throw new RangeError(); } }", "{ get member() { %s; return 1; } }" % P, "new Proxy({}, { get() { %s; } })" % P]),
 "read-element": ("x[0];", "[1]", ["null", "undefined", "{ get 0() { throw new RangeError(); } }"]),
 "read-deep": ("x.a.b;", "{ a: { b: 1 } }", ["{}", "{ a: null }"]),
 "read-optional-deep": ("x?.a.b;", "{ a: { b: 1 } }", ["{}", "null"]),
 "read-under-a-key": ("({ a: 1 })[x];", '"a"', ["{ toString() { throw new RangeError(); } }", "{ toString() { %s; return 'a'; } }" % P, "Object.create(null)"]),
 "store-member": ("x.member = 1;", "{ member: 1 }", ["null", "undefined", "{ set member(v) { throw new RangeError(); } }", "{ set member(v) { %s; } }" % P, "Object.freeze({ member: 1 })", "{ get member() { return 1; } }"]),
 "store-element": ("x[0] = 1;", "[1]", ["null", "Object.freeze([1])"]),
 "store-length": ("[1, 2].length = x;", "1", ["-1", "1.5"]),
 "delete-member": ("delete x.member;", "{ member: 1 }", ["null", "Object.freeze({ member: 1 })"]),
 "in": ('"k" in x;', "{}", ["0", '"text"', "undefined", "null", "new Proxy({}, { has() { %s; return true; } })" % P]),
 "in-key": ("x in {};", '"k"', ["{ toString() { throw new RangeError(); } }"]),
 "instanceof": ("({}) instanceof x;", "function () {}", ["0", "{}", "{ [Symbol.hasInstance]() { %s; } }" % P, "Object.assign(function () {}, { prototype: 1 })"]),
 "spread-list": ("[...x];", "[1]", ["0", "undefined", "null", "{}", "{ [Symbol.iterator]() { %s; return [][Symbol.iterator](); } }" % P]),
 "spread-arguments": ("Math.max(...x);", "[1]", ["0", "undefined", "{}"]),
 "spread-arguments-of-a-function": ("((...all) => 1)(...x);", "[1]", ["0", "undefined", "{}"]),
 "spread-object": ("({ ...x });", "{ a: 1 }", ["{ get a() { throw new RangeError(); } }", "{ get a() { %s; return 1; } }" % P]),
 "new-set": ("new Set(x);", "[1]", ["0", "{}"]),
 "new-map": ("new Map(x);", "[[1, 1]]", ["0", "[1]"]),
 "object-pattern": ("const { a } = x;", "{ a: 1 }", ["null", "undefined", "{ get a() { %s; } }" % P]),
 "empty-object-pattern": ("const {} = x;", "{}", ["null", "undefined"]),
 "list-pattern": ("const [a] = x;", "[1]", ["null", "undefined", "0", "{}"]),
 "parameter-pattern": ("(({ a }) => 1)(x);", "{ a: 1 }", ["null", "undefined"]),
 "nested-pattern": ("const { a: { b } } = x;", "{ a: { b: 1 } }", ["{}", "{ a: null }"]),
 "for-of": ("for (const each of x) ;", "[1]", ["0", "null", "{}"]),
 "for-in": ("for (const each in x) ;", "{ a: 1 }", ["new Proxy({}, { ownKeys() { %s; return []; } })" % P]),
 "add": ("x + 1;", "1", ["1n", "Symbol()", "{ valueOf() { throw new RangeError(); } }", "{ valueOf() { %s; return 1; } }" % P, "Object.create(null)"]),
 "multiply": ("x * 2;", "1", ["1n", "Symbol()", "{ valueOf() { %s; return 1; } }" % P]),
 "divide-bigints": ("1n / x;", "1n", ["0n", "1"]),
 "power-of-bigints": ("2n ** x;", "1n", ["-1n"]),
 "unsigned-shift": ("x >>> 0;", "1", ["1n", "Symbol()"]),
 "plus": ("+x;", "1", ["1n", "Symbol()", "{ valueOf() { %s; return 1; } }" % P]),
 "minus": ("-x;", "1", ["Symbol()"]),
 "increment": ("let y = x; y++;", "1", ["Symbol()", "{ valueOf() { %s; return 1; } }" % P]),
 "compare": ("x < 1;", "1", ["Symbol()", "{ valueOf() { %s; return 1; } }" % P]),
 "loosely-equal": ("x == 1;", "1", ["{ valueOf() { %s; return 1; } }" % P, "{ [Symbol.toPrimitive]() { throw new RangeError(); } }"]),
 "template": ("`${x}`;", '"text"', ["Symbol()", "{ toString() { %s; return ''; } }" % P, "Object.create(null)"]),
 "concatenate": ('x + "";', '"text"', ["Symbol()", "Object.create(null)"]),
 "concatenate-behind": ('"" + x;', '"text"', ["Symbol()"]),
 "computed-key": ("({ [x]: 1 });", '"k"', ["{ toString() { throw new RangeError(); } }", "{ toString() { %s; return 'k'; } }" % P, "Object.create(null)"]),
 "computed-method-key": ("(class { [x]() {} });", '"k"', ["{ toString() { throw new RangeError(); } }", "{ toString() { %s; return 'k'; } }" % P]),
 "computed-static-key": ("(class { static [x]() {} });", '"k"', ['"prototype"']),
 "computed-field-key": ("(class { [x] = 1; });", '"k"', ["{ toString() { %s; return 'k'; } }" % P]),
 "math-abs": ("Math.abs(x);", "1", ["1n", "Symbol()", "{ valueOf() { %s; return 1; } }" % P]),
 "new-array": ("new Array(x);", "1", ["-1", "1.5"]),
 "repeat": ('"a".repeat(x);', "1", ["-1", "Infinity"]),
 "to-fixed": ("(1).toFixed(x);", "1", ["101", "-1"]),
 "to-string-radix": ("(1).toString(x);", "2", ["1", "37"]),
 "json-parse": ("JSON.parse(x);", '"1"', ['"{"', "Symbol()"]),
 "json-stringify": ("JSON.stringify(x);", "1", ["1n", "(() => { const o = {}; o.o = o; return o; })()", "{ toJSON() { %s; } }" % P]),
 "new-regexp": ("new RegExp(x);", '"a"', ['"("', '"["']),
 "bigint-of": ("BigInt(x);", "1", ["1.5", '"a"', "undefined"]),
 "object-create": ("Object.create(x);", "null", ["0", "undefined"]),
 "object-keys": ("Object.keys(x);", "{}", ["null", "undefined"]),
 "object-entries": ("Object.entries(x);", "{}", ["null", "{ get a() { %s; return 1; } }" % P]),
 "object-assign": ("Object.assign({}, x);", "{}", ["{ get a() { throw new RangeError(); } }"]),
 "object-assign-target": ("Object.assign(x, { a: 1 });", "{}", ["null", "Object.freeze({})"]),
 "object-from-entries": ("Object.fromEntries(x);", "[]", ["0", "[1]"]),
 "set-prototype-of": ("Object.setPrototypeOf({}, x);", "null", ["0", "undefined"]),
 "define-property": ("Object.defineProperty(x, 'k', {});", "{}", ["0", "Object.freeze({})"]),
 "define-property-descriptor": ("Object.defineProperty({}, 'k', x);", "{}", ["0", "{ get() {}, value: 1 }"]),
 "reflect-own-keys": ("Reflect.ownKeys(x);", "{}", ["0"]),
 "weak-map-set": ("new WeakMap().set(x, 1);", "{}", ["1", '"a"']),
 "weak-ref": ("new WeakRef(x);", "{}", ["1"]),
 "reduce": ("x.reduce((a, b) => a);", "[1]", ["[]"]),
 "from-code-point": ("String.fromCodePoint(x);", "1", ["-1", "1.5"]),
 "normalize": ('"a".normalize(x);', '"NFC"', ['"x"']),
 "to-iso-string": ("new Date(x).toISOString();", "0", ["NaN"]),
 "decode": ("decodeURIComponent(x);", '"a"', ['"%"']),
 "symbol-key-for": ("Symbol.keyFor(x);", "Symbol()", ['"a"']),
 "symbol-description": ("Symbol(x);", '"a"', ["Symbol()"]),
 "structured-clone": ("structuredClone(x);", "1", ["() => 1", "Symbol()"]),
 "array-at-call": ("Array.prototype.at.call(x, 0);", "[1]", ["null"]),
 "string-method-call": ("String.prototype.trim.call(x);", '"a"', ["null", "Symbol()"]),
 "map-get-call": ("Map.prototype.get.call(x, 1);", "new Map()", ["{}", "new Set()"]),
 "typed-array": ("new Uint8Array(x);", "1", ["-1"]),
 "array-buffer": ("new ArrayBuffer(x);", "1", ["-1"]),
 "data-view": ("new DataView(new ArrayBuffer(1), x);", "0", ["2"]),
 "number-format": ("new Intl.NumberFormat(x);", '"en"', ['"x"']),
 "locale-compare": ('"a".localeCompare("b", x);', '"en"', ['"x"']),
 "to-string-of": ("x.toString();", "1", ["Object.create(null)", "null"]),
 "string-of": ("String(x);", "1", ["Object.create(null)", "{ toString() { %s; return ''; } }" % P]),
 "number-of": ("Number(x);", "1", ["Symbol()", "1n", "{ valueOf() { %s; return 1; } }" % P]),
 "array-join": ("[x].join();", "1", ["Symbol()", "{ toString() { %s; return ''; } }" % P]),
 "array-sort": ("[x, x].sort();", "1", ["Symbol()"]),
 "array-includes-from": ("[1].includes(1, x);", "0", ["Symbol()", "{ valueOf() { %s; return 0; } }" % P]),
 "array-fill-frozen": ("x.fill(0);", "[1]", ["Object.freeze([1])"]),
 "array-push-frozen": ("x.push(0);", "[1]", ["Object.freeze([1])"]),
 "array-concat": ("[].concat(x);", "[1]", ["{ get [Symbol.isConcatSpreadable]() { %s; return false; } }" % P]),
 "array-flat": ("[x].flat(Infinity);", "[1]", []),
 "new-derived": ("new x();", "class {}", ["class extends Thrower { constructor() { super(); } }", "class extends Thrower {}", "class extends null {}", "class extends Object { constructor() {} }", "class extends Object { constructor() { super(); return 1; } }", "class extends Object { constructor() { super(); super(); } }", "class extends Printer {}", "class { constructor() { throw new RangeError(); } }", "class { field = (() => { throw new RangeError(); })(); }", "class { static #p; constructor() { ({}).#p; } }"], "class Thrower { constructor() { throw new RangeError(); } }\nclass Printer { constructor() { %s; } }" % P),
 "private-read": ("Holder.read(x);", "new Holder()", ["{}", "null"], "class Holder { #p = 1; static read(o) { return o.#p; } }"),
 "private-in": ("Holder.has(x);", "new Holder()", ["0", "null"], "class Holder { #p = 1; static has(o) { return #p in o; } }"),
 "private-store": ("Holder.store(x);", "new Holder()", ["{}"], "class Holder { #p = 1; static store(o) { o.#p = 2; } }"),
 "private-method": ("Holder.call(x);", "new Holder()", ["{}"], "class Holder { #m() {} static call(o) { o.#m(); } }"),
 "super-member": ("({ __proto__: x, m() { return super.member; } }).m();", "{ member: 1 }", ["{ get member() { throw new RangeError(); } }", "{ get member() { %s; } }" % P]),
 "super-call": ("({ __proto__: x, m() { super.member(); } }).m();", "{ member() {} }", ["{}", "null"]),
 "store-under-a-setter-above": ("({ __proto__: x, other: 1 }).member = 1;", "{}", ["{ set member(v) { throw new RangeError(); } }", "{ set member(v) { %s; } }" % P, "Object.freeze({ member: 1 })", "{ get member() { return 1; } }"]),
 "read-under-a-getter-above": ("({ __proto__: x, other: 1 }).member;", "{}", ["{ get member() { throw new RangeError(); } }", "{ get member() { %s; } }" % P]),
 "object-create-store": ("Object.create(x).member = 1;", "{}", ["{ set member(v) { throw new RangeError(); } }", "Object.freeze({ member: 1 })"]),
 "extends": ("(class extends x {});", "class {}", ["0", "undefined", "Math.abs", "Object.assign(function () {}, { prototype: 1 })", "function* () {}", "new Proxy(class {}, { get() { %s; return null; } })" % P]),
 "await": ("(async () => { await x; })();", "1", ["{ then() { %s; } }" % P, "{ get then() { %s; } }" % P]),
 "await-in-a-method": ("({ async m() { await x; } }).m();", "1", ["{ then() { %s; } }" % P]),
 "yield": ("(function* () { yield x.member; })().next();", "{ member: 1 }", ["null"]),
 "yield-star": ("(function* () { yield* x; })().next();", "[1]", ["0", "null"]),
 "async-rejection": ("(async () => { x.member; })().catch(error => console.log('rejected', error.name));", "{ member: 1 }", ["null"]),
 "promise-resolve": ("Promise.resolve(x);", "1", ["{ get then() { %s; } }" % P, "{ then() { %s; } }" % P]),
 "throw": ("if (x) throw new RangeError();", "0", ["1"]),
 "print": ("if (x) %s;" % P, "0", ["1"]),
 "assign-to-a-constant": ("const c = 1; if (x) c = 2;", "0", ["1"]),
 "unknown-name": ("if (x) nowhere;", "0", ["1"]),
 "typeof-unknown-name": ("if (x) typeof nowhere;", "0", ["1"]),
 "store-to-an-unknown-name": ("if (x) nowhere = 1;", "0", ["1"]),
 "dead-zone": ("if (x) later;", "0", ["1"], "", "let later = 1;"),
 "dead-zone-of-a-class": ("if (x) Later;", "0", ["1"], "", "class Later {}"),
 "dead-zone-of-a-constant-called": ("if (x) later();", "0", ["1"], "", "const later = () => 1;"),
 "dead-zone-typeof": ("if (x) typeof later;", "0", ["1"], "", "let later = 1;"),
 "dead-zone-store": ("if (x) later = 2;", "0", ["1"], "", "let later = 1;"),
 "endless-recursion": ("const again = n => n ? again(n) + 1 : 0; again(x);", "0", ["1"]),
 "with-arguments-callee": ("(function () { 'use strict'; if (x) arguments.callee; })();", "0", ["1"]),
 "function-caller": ("(function f() { 'use strict'; if (x) f.caller; })();", "0", ["1"]),
 "date-now": ("seen.push(counter);", "0", ["1"], "const seen = []; let counter = 0;"),
}
# frame(operation, behind): the text inside scene()
places = {
  "a-method-of-a-literal": "({ answers() { OPERATION } }).answers(); BEHIND",
  "two-deep": "({ outer() { ({ inner() { OPERATION } }).inner(); } }).outer(); BEHIND",
  "a-method-that-hands-back-a-literal": "const unread = ({ answers() { OPERATION return { a: [1, 2, 3], b: { c: 1 } }; } }).answers(); BEHIND",
  "a-helper-that-fills-a-literal": "const fill = into => { OPERATION into.a = 1; return into; }; const unread = fill({ b: [1, 2, 3], c: { d: 1 } }); BEHIND",
}
n = 0
for name, row in O.items():
    operation, other, arrivals = row[:3]; front = row[3] if len(row) > 3 else ""; behind = row[4] if len(row) > 4 else ""
    for place, frame in places.items():
        for index, value in enumerate(arrivals):
            body = frame.replace("OPERATION", operation).replace("BEHIND", behind)
            text = f"""const given = JSON.parse('{{ "off": false }}');
{front}
function scene(arrives) {{
  let x = arrives;
  if (given.off) x = {other};
  {body}
}}
try {{ scene({value}); console.log("returned"); }} catch (error) {{ console.log(error.name); }}
"""
            open(f"{out}/{name}--{place}--{index}.js", "w").write(text); n += 1
    # At the top level of a file: the initializer of a constant that a function reads: never at run time, or late.
    for index, value in enumerate(arrivals):
        for place, tail in (("a-constant-never-read", 'if (given.off) console.log(use());\nconsole.log("returned");'), ("a-constant-read-late", 'console.log("between"); console.log(typeof use().a); console.log("returned");')):
            text = f"""const given = JSON.parse('{{ "off": false }}');
process.on("uncaughtException", error => {{ console.log("uncaught", error.name); process.exit(0); }});
{front}
const x = given.off ? {other} : {value};
function make() {{ {operation} return {{ a: [1, 2, 3], b: {{ c: 1 }}, d: [4, 5, 6] }}; }}
const held = make();
function use() {{ return held; }}
{behind}
{tail}
"""
            open(f"{out}/{name}--{place}--{index}.js", "w").write(text); n += 1
print(n)
