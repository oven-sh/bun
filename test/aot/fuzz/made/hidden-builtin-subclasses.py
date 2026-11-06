#!/usr/bin/env python3
"""hidden-builtin-subclasses.py <folder>: ONE CASE A FOLDER: compiled code calls the methods of a class of the engine without looking them up, unless the class is SEEN to be extended. So: one program a cell, in which NO class is seen to extend the built-in, and an object of the built-in's type gets another method all the same, by every road JavaScript has:
 own       a property of its own on the instance, stored through any
 proto     Object.setPrototypeOf(instance, { __proto__: B.prototype, m() {..} })
 text      a class made at run time: new Function("return class extends B { m() {..} }")()
 construct Reflect.construct(B, args, F): F a plain function whose prototype inherits from B.prototype and has m
 mixin     const mix = (Base: any) => class extends Base { m() {..} }; mix(B)
 alias     const Base: any = B; class X extends Base { m() {..} }
 cast      class X extends (B as any) { m() {..} }
 js        the heir is declared in a .js file of the program and handed over
Then typed code that takes the BASE type calls m, cold and after 3,000 warm calls with a plain one. The judge is plain Bun."""
import os, sys
out = sys.argv[1]
# name, type, how a plain one is made (args text), method, override body (returns a well typed other answer), the use in typed code
B = [
 ("Map", "Map<string, number>", '[["a", 1]]', "get", "return 4242;", 'o.get("a")'), ("Map", "Map<string, number>", '[["a", 1]]', "has", "return false;", 'o.has("a")'), ("Map", "Map<string, number>", '[["a", 1]]', "set", 'globalThis.hit = (globalThis.hit || 0) + 1; return this;', '(o.set("b", 2), (globalThis as any).hit ?? 0)'), ("Map", "Map<string, number>", '[["a", 1]]', "forEach", 'f(7, "heir", this);', '(() => { let s = ""; o.forEach((v, k) => { s += k + v; }); return s; })()'), ("Map", "Map<string, number>", '[["a", 1]]', "keys", 'return ["heir"][Symbol.iterator]();', '[...o.keys()].join()'),
 ("Set", "Set<string>", '["a"]', "has", "return false;", 'o.has("a")'), ("Set", "Set<string>", '["a"]', "add", 'globalThis.hit = (globalThis.hit || 0) + 1; return this;', '(o.add("b"), (globalThis as any).hit ?? 0)'),
 ("WeakMap", "WeakMap<object, number>", '[[globalThis, 1]]', "get", "return 4242;", 'o.get(globalThis)'), ("WeakSet", "WeakSet<object>", '[globalThis]', "has", "return false;", 'o.has(globalThis)'),
 ("Array", "number[]", '1, 2, 3', "indexOf", "return 4242;", 'o.indexOf(2)'), ("Array", "number[]", '1, 2, 3', "push", "return 4242;", 'o.push(9)'), ("Array", "number[]", '1, 2, 3', "map", "return [4242];", 'o.map(x => x).join()'), ("Array", "number[]", '1, 2, 3', "join", 'return "heir";', 'o.join()'), ("Array", "number[]", '1, 2, 3', "includes", "return false;", 'o.includes(2)'), ("Array", "number[]", '1, 2, 3', "slice", "return [4242];", 'o.slice(1).join()'), ("Array", "number[]", '1, 2, 3', "at", "return 4242;", 'o.at(0)'), ("Array", "number[]", '1, 2, 3', "forEach", "f(4242, 0, this);", '(() => { let t = 0; o.forEach(v => { t += v; }); return t; })()'),
 ("Date", "Date", '0', "getTime", "return 4242;", 'o.getTime()'), ("Date", "Date", '0', "toISOString", 'return "heir";', 'o.toISOString()'), ("Date", "Date", '0', "getFullYear", "return 4242;", 'o.getFullYear()'), ("Date", "Date", '0', "valueOf", "return 4242;", '+o'), ("Date", "Date", '0', "toJSON", 'return "heir";', 'JSON.stringify(o)'),
 ("RegExp", "RegExp", '"b"', "test", "return false;", 'o.test("abc")'), ("RegExp", "RegExp", '"b"', "exec", "return null;", '[o.exec("abc") === null, o.test("abc"), "abc".replace(o, "_"), "abc".search(o)].join()'),
 ("Promise", "Promise<number>", '(r: any) => r(1)', "then", 'return Promise.prototype.then.call(this, () => f(4242));', 'o'), 
 ("Uint8Array", "Uint8Array", '[1, 2, 3]', "indexOf", "return 4242;", 'o.indexOf(2)'), ("Uint8Array", "Uint8Array", '[1, 2, 3]', "at", "return 4242;", 'o.at(0)'), ("Uint8Array", "Uint8Array", '[1, 2, 3]', "subarray", "return new Uint8Array(9);", 'o.subarray(1).length'), ("Float64Array", "Float64Array", '[1, 2, 3]', "join", 'return "heir";', 'o.join()'), ("Int32Array", "Int32Array", '[1, 2, 3]', "fill", "return this;", 'o.fill(7)[0]'),
 ("DataView", "DataView", 'new ArrayBuffer(4)', "getInt8", "return 42;", 'o.getInt8(0)'), ("ArrayBuffer", "ArrayBuffer", '8', "slice", "return new ArrayBuffer(1);", 'o.slice(0).byteLength'),
 ("String", "String", '"abc"', "charAt", 'return "heir";', 'o.charAt(0)'), ("String", "String", '"abc"', "toString", 'return "heir";', '`${o}`'), ("Number", "Number", '5', "toFixed", 'return "heir";', 'o.toFixed(1)'), ("Number", "Number", '5', "valueOf", "return 4242;", '(o as any) + 1'), ("Boolean", "Boolean", 'true', "valueOf", "return false;", 'o.valueOf()'),
 ("Error", "Error", '"m"', "toString", 'return "heir";', 'String(o)'), ("TypeError", "TypeError", '"m"', "toString", 'return "heir";', 'String(o)'), ("Function", "Function", '"return 1"', "call", "return 4242;", 'o.call(null)'), ("Object", "Object", '', "toString", 'return "heir";', 'String(o)'), ("Object", "Object", '', "hasOwnProperty", "return true;", 'o.hasOwnProperty("nope")'),
]
GEN = {"Map": "<string, number>", "Set": "<string>", "WeakMap": "<object, number>", "WeakSet": "<object>", "Array": "<number>", "Promise": "<number>", "DataView": "<ArrayBuffer>"}
P = lambda m: "f" if m in ("forEach", "then") else ""
def roads(b, args, m, body, ty):
    p = P(m); g = GEN.get(b, ""); tb = body.replace("globalThis.hit", "(globalThis as any).hit"); member = "override %s(%s): any { %s }" % (m, p and p + ": any", tb)
    return {
     "seen": 'class X extends %s%s { %s } const made: any = new (X as any)(%s);' % (b, g, member, args),
     "typed-alias": 'const Base = %s; class X extends Base%s { %s } const made: any = new (X as any)(%s);' % (b, g, member, args),
     "typed-call": 'function base() { return %s; } class X extends base()%s { %s } const made: any = new (X as any)(%s);' % (b, g, member, args),
     "typed-member": 'const bases = { K: %s }; class X extends bases.K%s { %s } const made: any = new (X as any)(%s);' % (b, g, member, args),
     "typed-cond": 'class X extends (Math.random() < 2 ? %s : %s)%s { %s } const made: any = new (X as any)(%s);' % (b, b, g, member, args),
     "typed-global": 'class X extends globalThis.%s%s { %s } const made: any = new (X as any)(%s);' % (b, g, member, args),
     "generic-mixin": 'const mix = <T extends new (...a: any[]) => %s>(Base: T) => class extends Base { %s }; const made: any = new (mix(%s) as any)(%s);' % (ty, member, b, args),
     "own": 'const made: any = new %s(%s); made.%s = function (%s) { %s };' % (b, args, m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit")),
     "proto": 'const made: any = new %s(%s); Object.setPrototypeOf(made, { __proto__: %s.prototype, %s(%s) { %s } });' % (b, args, b, m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit")),
     "text": 'const made: any = new (new Function("return class extends %s { %s(%s) { %s } }")())(%s);' % (b, m, p, body.replace('"', "'"), args),
     "construct": 'function F(this: any) {} F.prototype = Object.create(%s.prototype, { %s: { value: function (%s) { %s }, writable: true, configurable: true } }); const made: any = Reflect.construct(%s, [%s], F);' % (b, m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit"), b, args),
     "mixin": 'const mix = (Base: any) => class extends Base { %s(%s) { %s } }; const made: any = new (mix(%s) as any)(%s);' % (m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit"), b, args),
     "alias": 'const Base: any = %s; class X extends Base { %s(%s) { %s } } const made: any = new (X as any)(%s);' % (b, m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit"), args),
     "cast": 'class X extends (%s as any) { %s(%s) { %s } } const made: any = new (X as any)(%s);' % (b, m, p and p + ": any", body.replace("globalThis.hit", "(globalThis as any).hit"), args),
     "js": 'import { make } from "./heir.js"; const made: any = make();',
    }
n = 0
for b, ty, args, m, body, use in B:
    for road, text in roads(b, args, m, body, ty).items():
        d = os.path.join(out, "%s.%s.%s" % (b, m, road)); os.makedirs(d, exist_ok=True); n += 1
        aw = "await " if b == "Promise" else ""
        head = 'declare const console: any;\n'
        fn = ('async function use(o: %s) { return %s%s; }' if b == "Promise" else 'function use(o: %s) { return %s%s; }') % (ty, aw, use)
        plain = 'new %s(%s)' % (b, args)
        imp = ""
        if road == "js": imp, text = 'import { make } from "./heir.js";\n', 'const made: any = make();'
        main = head + imp + fn + "\nlet warm = 0; for (let i = 0; i < 3000; i++) { const r = %suse(%s); warm += r === undefined ? 0 : 1; }\n(globalThis as any).hit = 0;\ntry { %s\n console.log(String(%suse(made)), String(%suse(%s)), warm); } catch (e: any) { console.log('THROWS', e.constructor.name, String(e.message).slice(0, 110)); }\n" % (aw, plain, text, aw, aw, plain)
        open(os.path.join(d, "main.ts"), "w").write(main)
        if road == "js": open(os.path.join(d, "heir.js"), "w").write('class X extends %s { %s(%s) { %s } }\nexport const make = () => new X(%s);\n' % (b, m, P(m), body, args.replace("(r: any)", "r"))); open(os.path.join(d, "heir.d.ts"), "w").write("export declare function make(): any;\n")
print(n)
