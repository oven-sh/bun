#!/usr/bin/env python3
"""not-a-function-errors.py <folder>: One operation that throws for a non-function (a call, `new`, a tagged template, a
callback of a built-in ..), in one position of a program, with one non-function value arriving. Writes one file per
case.
"""
import itertools, os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# operation: (text that uses x, the other value of x: something for which the operation does nothing)
operations = {
  "call": ("x();", "() => 1"),
  "call-with-arguments": ("x(1, 2);", "() => 1"),
  "call-with-a-spread": ("x(...[1, 2]);", "() => 1"),
  "new": ("new x();", "function () {}"),
  "new-without-parentheses": ("new x;", "function () {}"),
  "new-of-a-class": ("new x();", "class {}"),
  "optional-call": ("x?.();", "() => 1"),
  "tagged-template": ("x`text`;", "() => 1"),
  "member-call": ("({ member: x }).member();", "() => 1"),
  "element-call": ("[x][0]();", "() => 1"),
  "optional-member-call": ("({ member: x }).member?.();", "() => 1"),
  "call-call": ("Function.prototype.call.call(x);", "() => 1"),
  "reflect-apply": ("Reflect.apply(x, undefined, []);", "() => 1"),
  "reflect-construct": ("Reflect.construct(x, []);", "function () {}"),
  "reflect-construct-new-target": ("Reflect.construct(function () {}, [], x);", "function () {}"),
  "getter-in-a-descriptor": ("Object.defineProperty({}, 'k', { get: x });", "() => 1"),
  "setter-in-a-descriptor": ("Object.defineProperty({}, 'k', { set: x });", "() => 1"),
  "define-getter": ("({}).__defineGetter__('k', x);", "() => 1"),
  "instanceof": ("({}) instanceof x;", "function () {}"),
  "extends": ("(class extends x {});", "class {}"),
  "map": ("[].map(x);", "() => 1"),
  "for-each": ("[1].forEach(x);", "() => 1"),
  "sort": ("[2, 1].sort(x);", "() => 1"),
  "new-promise": ("new Promise(x);", "() => 1"),
  "queue-microtask": ("queueMicrotask(x);", "() => 1"),
  "bind": ("Function.prototype.bind.call(x);", "() => 1"),
  "iterator": ("for (const each of { [Symbol.iterator]: x }) ;", "() => [][Symbol.iterator]()"),
  "spread-iterator": ("[...{ [Symbol.iterator]: x }];", "() => [][Symbol.iterator]()"),
  "pattern-iterator": ("const [] = { [Symbol.iterator]: x };", "() => [][Symbol.iterator]()"),
  "next": ("for (const each of { [Symbol.iterator]() { return { next: x }; } }) ;", "() => ({ done: true })"),
  "to-primitive": ("`${{ [Symbol.toPrimitive]: x }}`;", "() => 1"),
  "has-instance": ("1 instanceof { [Symbol.hasInstance]: x };", "() => 1"),
  "array-from": ("Array.from([], x);", "() => 1"),
  "map-group-by": ("Map.groupBy([], x);", "() => 1"),
  "proxy-trap": ("new Proxy({}, { get: x }).k;", "() => 1"),
  "weak-ref-registry": ("new FinalizationRegistry(x);", "() => 1"),
  "then-of-a-promise-species": ("Promise.prototype.then.call({ constructor: { [Symbol.species]: x } });", "function (f) { f(() => 1, () => 1); }"),
}
arrivals = { "zero": "0", "text": '"text"', "undefined": "undefined", "null": "null", "object": "{}" }
# For `new`: what is a function and no constructor; for a call: a class.
special = {
  "new": { "arrow": "() => 1", "method": "({ m() {} }).m", "async": "async function () {}", "generator": "function* () {}" },
  "new-of-a-class": { "arrow": "() => 1" },
  "reflect-construct": { "arrow": "() => 1" },
  "reflect-construct-new-target": { "arrow": "() => 1" },
  "extends": { "arrow": "() => 1", "generator": "function* () {}" },
  "call": { "class": "class {}", "derived-class": "class extends Object {}" },
  "member-call": { "class": "class {}" },
  "tagged-template": { "class": "class {}" },
  "optional-call": { "class": "class {}" },
  "reflect-apply": { "class": "class {}" },
  "call-call": { "class": "class {}" },
  "for-each": { "class": "class {}" },
}
places = {
  "a-method-of-a-literal": "({ answers() { OPERATION } }).answers();",
  "straight": "OPERATION",
  "an-arrow": "(() => { OPERATION })();",
  "a-getter-of-a-literal": "({ get answers() { OPERATION return 1; } }).answers;",
  "a-setter-of-a-literal": "({ set answers(v) { OPERATION } }).answers = 1;",
  "a-constructor": "new (class { constructor() { OPERATION } })();",
  "a-field": "new (class { field = (() => { OPERATION })(); })();",
  "a-static-block": "(class { static { OPERATION } });",
  "a-literal-nobody-reads": "const unread = { made: (() => { OPERATION return 1; })(), other: [1, 2, 3] };",
  "two-deep": "({ outer() { ({ inner() { OPERATION } }).inner(); } }).outer();",
}
n = 0
for (name, (operation, other)), (place, frame) in itertools.product(operations.items(), places.items()):
    for arrives, value in {**arrivals, **special.get(name, {})}.items():
        if place not in ("a-method-of-a-literal", "straight", "a-literal-nobody-reads") and arrives not in ("zero", "arrow", "class"):
            continue
        text = f"""const given = JSON.parse('{{ "off": false }}');
function scene(arrives) {{
  let x = arrives;
  if (given.off) x = {other};
  {frame.replace("OPERATION", operation)}
}}
try {{ scene({value}); console.log("returned"); }} catch (error) {{ console.log(error.name); }}
"""
        open(f"{out}/{name}--{place}--{arrives}.js", "w").write(text); n += 1
        # The same at the top level of the file, where the initializer of a constant nobody reads stands.
        if place in ("a-method-of-a-literal", "a-literal-nobody-reads") and arrives in ("zero", "arrow", "class"):
            top = f"""const given = JSON.parse('{{ "off": false }}');
process.on("uncaughtException", error => {{ console.log("uncaught", error.name); process.exit(0); }});
let x = {value};
if (given.off) x = {other};
{frame.replace("OPERATION", operation)}
console.log("returned");
"""
            open(f"{out}/{name}--{place}-at-the-top-level--{arrives}.js", "w").write(top); n += 1
print(n)
