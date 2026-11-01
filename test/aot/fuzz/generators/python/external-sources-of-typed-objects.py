#!/usr/bin/env python3
"""external-sources-of-typed-objects.py <part 1..17>: EVERY DOOR x EVERY KIND x { any, typed }. A kind is a way in which typed code makes an object: a literal, a record with optional members, an instance, an instance of an heir, a class, a closure, a tuple, an array.
A door is something that JavaScript lets anybody do to an object: integrity levels, defineProperty, descriptors, delete, queries, Reflect, prototypes, copies, Proxy, identity and collections, conversions, array methods, methods and accessors patched.
Each is done through a reference of type `any` and, where TypeScript lets it, through the typed one. A case prints one line: what the door answered, what typed readers see afterwards, the own properties with their attributes, what typed stores do, and all of that again;
`!TypeError` stands where something threw. Every case has types and names of its own, so that what the compiler sees of one case says nothing about another. Prints the part-th program of 120 cases; without a part, the names of all cases, a line each."""
import sys, json

# The kinds of objects of the matrix. Every case has types and names of its own (suffix n), so that what the checker sees of one case says nothing of another.
class Kind:
    def __init__(self, **k): self.__dict__.update(k)

def lit(n):
    return Kind(name='lit', decl=f'function mk{n}() {{ return {{ p{n}: 1, q{n}: "s" }}; }}\ntype T{n} = ReturnType<typeof mk{n}>;',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=None, m=None, g=None, C=None, v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"'], rd1=f'.p{n}', isarray=False, isfn=False)

def opt(n):
    return Kind(name='opt', decl=f'interface T{n} {{ p{n}: number; q{n}?: string; r{n}?: number }}\nfunction mk{n}(): T{n} {{ return {{ p{n}: 1, q{n}: "s" }}; }}',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=f'r{n}', m=None, g=None, C=None, v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}', f'o.r{n}'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"', f'o.r{n} = 9'], rd1=f'.p{n}', isarray=False, isfn=False)

def inst(n):
    return Kind(name='inst', decl=f'class C{n} {{ p{n} = 1; q{n} = "s"; m{n}() {{ return this.p{n} + 1; }} get g{n}() {{ return this.q{n} + "!"; }} }}\ntype T{n} = C{n};\nfunction mk{n}() {{ return new C{n}(); }}',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=None, m=f'm{n}', g=f'g{n}', C=f'C{n}', v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}', f'o.m{n}()', f'o.g{n}'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"'], rd1=f'.p{n}', isarray=False, isfn=False)

def derived(n):
    return Kind(name='derived', decl=f'class B{n} {{ p{n} = 1; m{n}() {{ return this.p{n} + 1; }} get g{n}() {{ return "b" + this.p{n}; }} }}\nclass C{n} extends B{n} {{ q{n} = "s"; m{n}() {{ return super.m{n}() + 10; }} }}\ntype T{n} = C{n};\nfunction mk{n}() {{ return new C{n}(); }}',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=None, m=f'm{n}', g=f'g{n}', C=f'C{n}', v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}', f'o.m{n}()', f'o.g{n}'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"'], rd1=f'.p{n}', isarray=False, isfn=False)

def klass(n):
    return Kind(name='class', decl=f'class C{n} {{ static p{n} = 1; static q{n} = "s"; static m{n}() {{ return C{n}.p{n} + 1; }} static get g{n}() {{ return C{n}.q{n} + "!"; }} i{n} = 3; }}\ntype T{n} = typeof C{n};\nfunction mk{n}() {{ return C{n}; }}',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=None, m=f'm{n}', g=f'g{n}', C='Function', v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}', f'o.m{n}()', f'o.g{n}', f'new o().i{n}'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"'], rd1=f'.p{n}', isarray=False, isfn=True)

def closure(n):
    return Kind(name='closure', decl=f'function mk{n}() {{ let c = 1; const f{n} = (v: number) => v + c++; f{n}.p{n} = 1; f{n}.q{n} = "s"; return f{n}; }}\ntype T{n} = ReturnType<typeof mk{n}>;',
        mk=f'mk{n}()', k1=f'p{n}', k2=f'q{n}', ko=None, m=None, g=None, C='Function', v1='7', v2='"t"', wrong='"wrong"',
        reads=[f'o.p{n}', f'o.q{n}', 'o(1)'], stores=[f'o.p{n} = 8', f'o.q{n} = "u"'], rd1=f'.p{n}', isarray=False, isfn=True)

def tuple_(n):
    return Kind(name='tuple', decl=f'type T{n} = [number, string];\nfunction mk{n}(): T{n} {{ return [1, "s"]; }}',
        mk=f'mk{n}()', k1='0', k2='1', ko=None, m=None, g=None, C='Array', v1='7', v2='"t"', wrong='"wrong"',
        reads=['o[0]', 'o[1]', 'o.length'], stores=['o[0] = 8', 'o[1] = "u"'], rd1='[0]', isarray=True, isfn=False)

def arr(n):
    return Kind(name='arr', decl=f'interface E{n} {{ e{n}: number }}\ntype T{n} = E{n}[];\nfunction mk{n}(): T{n} {{ return [{{ e{n}: 1 }}, {{ e{n}: 2 }}]; }}',
        mk=f'mk{n}()', k1='0', k2='1', ko=None, m=None, g=None, C='Array', v1=f'{{ e{n}: 7 }}', v2=f'{{ e{n}: 6 }}', wrong='"wrong"',
        reads=[f'o[0].e{n}', f'o[1].e{n}', 'o.length'], stores=[f'o[0] = {{ e{n}: 8 }}', f'o[1].e{n} = 9'], rd1='[0]', isarray=True, isfn=False)

KINDS = [lit, opt, inst, derived, klass, closure, tuple_, arr]

# Doors, part A: integrity levels, defineProperty, descriptors, delete.
# allowed=True: a TypeError of --aot is expected there: a value of the wrong type stored to a typed field; `delete` of a required raw number.
# A door: name, expression over $x for the mode `any`, the same for the mode `typed` ('same', or None where it does not type-check), statements before, expression after, kinds.
def D(name, any_, typed='same', pre='', post='', only=None, allowed=False):
    return dict(name=name, any=any_, typed=typed, pre=pre, post=post, only=only, allowed=allowed)
notfn = lambda k: not k.isfn
obj = lambda k: not k.isfn and not k.isarray
W = 'writable: true, enumerable: true, configurable: true'

DOORS_A = [
    # integrity
    D('freeze', 'Object.freeze($x) === $x'),
    D('seal', 'Object.seal($x) === $x'),
    D('preventExtensions', 'Object.preventExtensions($x) === $x'),
    D('Reflect.preventExtensions', 'Reflect.preventExtensions($x)'),
    D('integrity tests', '[Object.isFrozen($x), Object.isSealed($x), Object.isExtensible($x), Reflect.isExtensible($x)]'),
    D('freeze, add, delete', '(Object.freeze($x), [tr(() => { a.extra = 1; return "extra" in a; }), tr(() => delete a[$K1])])'),
    D('seal, add, delete', '(Object.seal($x), [tr(() => { a.extra = 1; return "extra" in a; }), tr(() => delete a[$K1])])'),
    D('preventExtensions, add', '(Object.preventExtensions($x), tr(() => { a.extra = 1; return "extra" in a; }))'),
    D('extra, then freeze', '(a.extra = 1, Object.freeze($x), tr(() => { a.extra = 2; return a.extra; }))', post='tr(() => a.extra)'),
    # defineProperty on a field
    D('define same attributes', 'Object.defineProperty($x, $K1, { value: $V1, ' + W + ' }) === $x'),
    D('define value only', 'Object.defineProperty($x, $K1, { value: $V1 }) === $x'),
    D('define read-only', 'Object.defineProperty($x, $K1, { value: $V1, writable: false }) === $x'),
    D('define not enumerable', 'Object.defineProperty($x, $K1, { enumerable: false }) === $x', post='tr(() => Object.keys(a))'),
    D('define not configurable', 'Object.defineProperty($x, $K1, { configurable: false }) === $x', post='tr(() => delete a[$K1])'),
    D('define getter', 'Object.defineProperty($x, $K1, { get() { return $V1; }, enumerable: true, configurable: true }) === $x'),
    D('define getter and setter', 'Object.defineProperty($x, $K1, { get() { return $V1; }, set(v: unknown) { log.push(v); }, enumerable: true, configurable: true }) === $x', pre='const log: unknown[] = [];', post='show(log)'),
    D('define getter, back to data', '(Object.defineProperty($x, $K1, { get() { return $V1; }, configurable: true }), Object.defineProperty($x, $K1, { value: $V1, ' + W + ' }) === $x)'),
    D('define wrong type', 'Object.defineProperty($x, $K1, { value: $WRONG, ' + W + ' }) === $x', allowed=True),
    D('defineProperties', 'Object.defineProperties($x, { [$K1]: { value: $V1, ' + W + ' }, extra: { value: 1, enumerable: true } }) === $x', post='tr(() => a.extra)'),
    D('Reflect.defineProperty', 'Reflect.defineProperty($x, $K1, { value: $V1 })'),
    D('Reflect.defineProperty getter', 'Reflect.defineProperty($x, $K1, { get() { return $V1; }, configurable: true })'),
    D('__defineGetter__', 'a.__defineGetter__($K1, () => $V1)', typed=None),
    D('__lookupGetter__', '[a.__lookupGetter__($K1), a.__lookupSetter__($K1)]', typed=None),
    # defineProperty of what the type does not have
    D('define new', 'Object.defineProperty($x, "extra", { value: 5, ' + W + ' }) === $x', post='tr(() => a.extra)'),
    D('define new, no attributes', 'Object.defineProperty($x, "extra", { value: 5 }) === $x', post='[tr(() => a.extra), tr(() => { a.extra = 6; return a.extra; }), tr(() => delete a.extra)]'),
    D('define new getter', 'Object.defineProperty($x, "extra", { get() { return 6; }, configurable: true }) === $x', post='tr(() => a.extra)'),
    D('define new setter', 'Object.defineProperty($x, "extra", { set(v: unknown) { log.push(v); }, configurable: true }) === $x', pre='const log: unknown[] = [];', post='[tr(() => { a.extra = 3; return a.extra; }), show(log)]'),
    D('define symbol', 'Object.defineProperty($x, sym, { value: 5, ' + W + ' }) === $x', post='tr(() => a[sym])'),
    D('define index', 'Object.defineProperty($x, "5", { value: 5, ' + W + ' }) === $x', post='tr(() => a[5])', only=lambda k: k.name != 'arr'),
    D('define absent optional', 'Object.defineProperty($x, $KO, { value: 4, ' + W + ' }) === $x', only=lambda k: k.ko),
    D('define absent optional getter', 'Object.defineProperty($x, $KO, { get() { return 4; }, enumerable: true, configurable: true }) === $x', only=lambda k: k.ko),
    D('define absent optional read-only', 'Object.defineProperty($x, $KO, { value: 4 }) === $x', only=lambda k: k.ko),
    # descriptors
    D('getOwnPropertyDescriptor', '[Object.getOwnPropertyDescriptor($x, $K1), Object.getOwnPropertyDescriptor($x, "nope"), Reflect.getOwnPropertyDescriptor($x, $K2)]'),
    D('getOwnPropertyDescriptors', 'Object.getOwnPropertyDescriptors($x)'),
    D('descriptor of a method', '[Object.getOwnPropertyDescriptor($x, $M), Object.getOwnPropertyDescriptor(P, $M), Object.getOwnPropertyDescriptor(P, $G)]', only=lambda k: k.m),
    D('descriptor round trip', 'Object.defineProperties({}, hide(Object.getOwnPropertyDescriptors($x)))', only=notfn),
    # delete
    D('delete by name', 'delete $x$.1', typed=None, allowed=True),
    D('delete computed', 'delete $x[key($K1)]', typed=None, allowed=True),
    D('Reflect.deleteProperty', 'Reflect.deleteProperty($x, $K1)', allowed=True),
    D('delete optional', 'delete $x$.2', only=lambda k: k.ko),
    D('delete absent optional', 'delete $x$.o', only=lambda k: k.ko),
    D('delete absent', 'Reflect.deleteProperty($x, "nope")'),
    D('delete, add again', '(delete a[$K1], a[$K1] = $V1, Object.keys($x))', typed=None, allowed=True),
    D('delete, in, read', '(delete a[$K1], [$K1 in $x, a[$K1], Object.keys($x)])', typed=None, allowed=True),
    D('delete extra', '(a.extra = 1, [delete a.extra, "extra" in $x])'),
    D('delete both', '(delete a[$K1], delete a[$K2], Object.keys($x))', typed=None, allowed=True),
]

# Doors, part B: queries, Reflect, prototypes, copies.

DOORS_B = [
    # queries
    D('in', '[$K1 in $x, "nope" in $x, "toString" in $x]'),
    D('in, method', '[$M in $x, $G in $x]', only=lambda k: k.m),
    D('in, absent optional', '[$KO in $x, Object.hasOwn($x, $KO)]', only=lambda k: k.ko),
    D('hasOwn', '[Object.hasOwn($x, $K1), Object.hasOwn($x, "nope"), Object.prototype.hasOwnProperty.call($x, $K1), Object.prototype.propertyIsEnumerable.call($x, $K1)]'),
    D('hasOwnProperty method', '[a.hasOwnProperty($K1), a.hasOwnProperty("toString"), a.propertyIsEnumerable($K2)]', typed=None),
    D('keys values entries', '[Object.keys($x), Object.values($x), Object.entries($x)]'),
    D('getOwnPropertyNames', '[Object.getOwnPropertyNames($x), Object.getOwnPropertySymbols($x).length]'),
    D('ownKeys', 'Reflect.ownKeys($x).map(String)'),
    D('for in', '(() => { const ks: string[] = []; for (const k in $x) ks.push(k); return ks; })()'),
    D('for in, inherited', '(() => { const ks: string[] = []; for (const k in Object.create($x)) ks.push(k); return ks; })()'),
    D('order of extras', '(a.z = 1, a[2] = 2, a.b = 3, a[1] = 4, a[sym] = 5, Reflect.ownKeys($x).map(String))', only=lambda k: not k.isarray),
    D('symbols', '(a[sym] = 5, [Object.getOwnPropertySymbols($x).length, a[sym], sym in $x, Object.keys($x)])'),
    D('store extra', '(a.extra = 1, [a.extra, "extra" in $x, Object.keys($x)])'),
    D('store extra computed', '(a[key("extra")] = 1, [a[key("extra")], Object.keys($x)])'),
    D('store field computed', '(a[key($K1)] = $V1, a[key($K1)])', typed=None),
    D('store wrong type', '(a[key($K1)] = $WRONG, a[key($K1)])', typed=None, allowed=True),
    D('store undefined', '(a[key($K1)] = undefined, a[key($K1)])', typed=None, allowed=True),
    # Reflect
    D('Reflect.get has', '[Reflect.get($x, $K1), Reflect.get($x, "nope"), Reflect.has($x, $K1), Reflect.has($x, "nope")]'),
    D('Reflect.set', '[Reflect.set($x, $K1, $V1), Reflect.set($x, "extra", 1)]', post='tr(() => a.extra)'),
    D('Reflect.set receiver', '(() => { const other: any = {}; return [Reflect.set($x, $K1, $V1, other), other]; })()'),
    D('Reflect.set, ours the receiver', '(() => { const other: any = { set [$K1](v: unknown) { Object.defineProperty(this, "seen", { value: v, ' + W + ' }); } }; return [Reflect.set(other, $K1, 5, $x), a.seen]; })()'),
    D('Reflect.get receiver', 'Reflect.get($x, $G, { [$K1]: 40, [$K2]: "other" })', only=lambda k: k.g and k.name != 'class'),
    D('Reflect.apply', 'Reflect.apply(a[$M], $x, [])', only=lambda k: k.m),
    D('method on another receiver', 'tr(() => a[$M].call({ [$K1]: 40 }))', only=lambda k: k.m and k.name != 'class'),
    D('method detached', '(() => { const f = a[$M]; return tr(() => f()); })()', only=lambda k: k.m),
    D('method bound', '(() => { const f = a[$M].bind($x); return f(); })()', only=lambda k: k.m),
    # prototypes
    D('getPrototypeOf', '[Object.getPrototypeOf($x) === P, Reflect.getPrototypeOf($x) === P, a.__proto__ === P, Object.prototype.isPrototypeOf.call(P, $x)]'),
    D('setPrototypeOf same', 'Object.setPrototypeOf($x, P) === $x'),
    D('setPrototypeOf object', 'Object.setPrototypeOf($x, { hello() { return "hi"; } }) === $x', post='[tr(() => a.hello()), tr(() => "toString" in a)]'),
    D('setPrototypeOf null', 'Object.setPrototypeOf($x, null) === $x', post='[tr(() => "toString" in a), tr(() => Object.getPrototypeOf(a))]'),
    D('setPrototypeOf heir of own', 'Object.setPrototypeOf($x, Object.create(P, { hello: { value: () => "hi" } })) === $x', post='tr(() => a.hello())'),
    D('Reflect.setPrototypeOf', 'Reflect.setPrototypeOf($x, { hello() { return "hi"; } })', post='tr(() => a.hello())'),
    D('__proto__ store', '(a.__proto__ = { hello() { return "hi"; } }, a.hello())', typed=None),
    D('__proto__ null', '(a.__proto__ = null, Object.getPrototypeOf(a))', typed=None),
    D('setPrototypeOf, back', '(Object.setPrototypeOf($x, { hello() { return "hi"; } }), Object.setPrototypeOf($x, P) === $x)'),
    D('prototype supplies absent optional', 'Object.setPrototypeOf($x, { $ko: 4 }) === $x', only=lambda k: k.ko),
    D('prototype getter for absent optional', 'Object.setPrototypeOf($x, { get $ko() { return 4; } }) === $x', only=lambda k: k.ko),
    D('prototype setter for absent optional', 'Object.setPrototypeOf($x, { set $ko(v: number) { log.push(v); } }) === $x', pre='const log: unknown[] = [];', post='show(log)', only=lambda k: k.ko),
    D('prototype behind a deleted field', '(Object.setPrototypeOf($x, { [$K1]: $V1 }), delete a[$K1], a[$K1])', typed=None, only=obj, allowed=True),
    D('setPrototypeOf after preventExtensions', '(Object.preventExtensions($x), tr(() => Object.setPrototypeOf($x, {})))'),
    D('Object.create', '(() => { const h = Object.create($x); return [h[$K1], Object.keys(h), $K1 in h, Object.hasOwn(h, $K1), Object.getPrototypeOf(h) === a]; })()'),
    D('Object.create, store', '(() => { const h = Object.create($x); h[$K1] = $V1; return [h[$K1], a[$K1], Object.keys(h)]; })()'),
    D('Object.create, frozen parent', '(() => { const h = Object.create(Object.freeze($x)); return tr(() => { h[$K1] = $V1; return h[$K1]; }); })()'),
    D('heir into typed code', 'see$N(hide(Object.create($x)))', only=notfn),
    D('heir calls method', '(() => { const h = Object.create($x); h[$K1] = 40; return [h[$M](), h[$G]]; })()', only=lambda k: k.m),
    # copies
    D('assign from', 'Object.assign({}, $x)'),
    D('assign to', 'Object.assign($x, { [$K1]: $V1 }) === $x'),
    D('assign extra', 'Object.assign($x, { extra: 1 }) === $x', post='tr(() => a.extra)'),
    D('assign wrong type', 'Object.assign($x, hide({ [$K1]: $WRONG })) === $x', allowed=True),
    D('spread', '({ ...$x })'),
    D('spread over', '({ ...$x, [$K1]: $V1, extra: 1 })'),
    D('spread with extras', '(a.extra = 1, { ...$x })'),
    D('rest', '(() => { const { [$K1]: first, ...rest } = $x; return [first, rest]; })()', typed=None),
    D('rest typed', '(() => { const { $k1: first, ...rest } = $x; return [first, rest]; })()', only=lambda k: not k.isarray),
    D('array spread', '[...$x]', only=lambda k: k.isarray),
    D('structuredClone', 'structuredClone($x)'),
    D('structuredClone with extras', '(a.extra = [1], structuredClone($x))'),
    D('JSON.stringify', 'JSON.stringify($x)'),
    D('JSON.stringify replacer', '[JSON.stringify($x, (k, v) => typeof v === "number" ? v + 1 : v), JSON.stringify($x, [$K1]), JSON.stringify($x, null, 1)]'),
    D('JSON.stringify toJSON', '(a.toJSON = () => "custom", JSON.stringify($x))'),
    D('JSON.stringify nested', 'JSON.stringify({ in: $x, list: [$x] })'),
    D('fromEntries', 'Object.fromEntries(Object.entries($x))'),
]

# Doors, part C: Proxy, identity and collections, conversions, arrays, methods patched.
cls = lambda k: k.m is not None
ins = lambda k: k.name in ('inst', 'derived')

DOORS_C = [
    # Proxy
    D('Proxy, no traps', '(() => { const p: any = new Proxy($x, {}); return [p[$K1], $K1 in p, Object.keys(p), (p[$K1] = $V1, a[$K1]), (p.extra = 1, a.extra)]; })()'),
    D('Proxy, get trap', '(() => { const p: any = new Proxy($x, { get(t, k, r) { log.push(String(k)); return Reflect.get(t, k, r); } }); return [p[$K1], p.nope]; })()', pre='const log: unknown[] = [];', post='show(log)'),
    D('Proxy, set trap', '(() => { const p: any = new Proxy($x, { set(t, k, v, r) { log.push(String(k)); return Reflect.set(t, k, v, r); } }); p[$K1] = $V1; p.extra = 1; return [a[$K1], a.extra]; })()', pre='const log: unknown[] = [];', post='show(log)'),
    D('Proxy, all traps', '(() => { const h: any = {}; for (const n of ["has", "deleteProperty", "ownKeys", "getOwnPropertyDescriptor", "defineProperty", "getPrototypeOf", "isExtensible"]) h[n] = (...args: any[]) => { log.push(n); return (Reflect as any)[n](...args); }; const p: any = new Proxy($x, h); return [$K1 in p, Object.keys(p), Object.getPrototypeOf(p) === P, Object.isExtensible(p), Object.defineProperty(p, "extra", { value: 1, configurable: true }) === p, delete p.extra]; })()', pre='const log: unknown[] = [];', post='show(log)'),
    D('Proxy into typed code', 'see$N(new Proxy($x, {}))'),
    D('Proxy into typed code, stores', '(() => { const p = new Proxy($x, {}); return [put$N(p), see$N(p)]; })()'),
    D('Proxy with a lying get', 'see$N(new Proxy($x, { get(t, k, r) { return k === $K1 ? $V1 : Reflect.get(t, k, r); } }))'),
    D('Proxy, ours the handler', '(() => { const p: any = new Proxy({ z: 1 }, $x); return [p.z, "z" in p, Object.keys(p)]; })()', typed=None),
    D('Proxy, ours the handler with a trap', '(a.get = (t: any, k: any) => "trapped " + String(k), (new Proxy({}, $x) as any).z)', typed=None),
    D('Proxy.revocable', '(() => { const { proxy, revoke } = Proxy.revocable($x, {}); const before = (proxy as any)[$K1]; revoke(); return [before, tr(() => (proxy as any)[$K1])]; })()'),
    D('Proxy of frozen', '(() => { const p: any = new Proxy(Object.freeze($x), {}); return [Object.isFrozen(p), tr(() => { p[$K1] = $V1; return 1; })]; })()'),
    # identity, collections
    D('instanceof', '[$x instanceof Object, $x instanceof $C, a.constructor === $C]', only=lambda k: k.C),
    D('instanceof Object', '[$x instanceof Object, a.constructor === Object, typeof $x]', only=lambda k: not k.C),
    D('hasInstance', '(() => { const Z: any = { [Symbol.hasInstance](v: any) { return v === a; } }; return $x instanceof Z; })()'),
    D('WeakMap WeakSet WeakRef', '(() => { const w = new WeakMap<object, number>(); w.set($x, 1); const s = new WeakSet<object>(); s.add($x); const r = new WeakRef<object>($x); return [w.get($x), w.has($x), s.has($x), r.deref() === $x, w.delete($x), w.has($x)]; })()'),
    D('Map Set keys', '(() => { const w = new Map<unknown, number>(); w.set($x, 1); const s = new Set<unknown>(); s.add($x); s.add($x); return [w.get($x), w.get(a), s.size, [...s][0] === a]; })()'),
    D('FinalizationRegistry', '(() => { const f = new FinalizationRegistry<number>(() => {}); f.register($x, 1, $x); return f.unregister($x); })()'),
    D('Object.is, equality', '[Object.is($x, a), $x === a, $x == a, [$x].includes(a), [$x].indexOf(a)]'),
    D('Object()', '[Object($x) === a, new Object($x) === a]'),
    # conversions
    D('toString tag', '[Object.prototype.toString.call($x), (a[Symbol.toStringTag] = "Mine", Object.prototype.toString.call($x))]'),
    D('toPrimitive', '(a[Symbol.toPrimitive] = (hint: string) => hint === "number" ? 42 : "prim", [+a, `${a}`, a + ""])'),
    D('own valueOf', '(a.valueOf = () => 5, [a + 1, a * 2, a > 4])'),
    D('own toString', '(a.toString = () => "str", [String($x), `${a}`, a + "", [$x].join()])'),
    D('String', '[String($x), `${a}`, a + ""]', only=notfn),
    D('own iterator', '(a[Symbol.iterator] = function* () { yield 1; yield 2; }, [[...a], Array.from(a)])'),
    D('array-like', '(a.length = 2, a[0] = "x", a[1] = "y", [Array.prototype.join.call($x, "-"), Array.from(a), Array.prototype.map.call($x, (v: any) => v + v)])', only=obj),
    D('thenable', '(a.then = (f: (v: unknown) => void) => f("then"), typeof Promise.resolve($x).then)'),
    D('typeof, truthiness', '[typeof $x, !$x, !!a, a ? 1 : 2, a ?? 3 === a]'),
    # arrays
    D('length = 0', '(a.length = 0, a.length)', only=lambda k: k.isarray, typed=None),
    D('hole', '(delete a[0], [0 in $x, a.length])', only=lambda k: k.isarray, typed=None),
    D('far store', '(a[10] = $V1, [a.length, 5 in $x])', only=lambda k: k.isarray, typed=None),
    D('named property', '(a.foo = 1, [a.foo, Object.keys($x), JSON.stringify($x)])', only=lambda k: k.isarray),
    D('frozen, push', '(Object.freeze($x), [tr(() => a.push($V1)), tr(() => a.pop()), tr(() => { a.length = 0; return 1; }), tr(() => a.sort())])', only=lambda k: k.isarray),
    D('sealed, push', '(Object.seal($x), [tr(() => a.push($V1)), tr(() => a.pop())])', only=lambda k: k.isarray),
    D('isArray', '[Array.isArray($x), Array.isArray(new Proxy($x, {})), Array.isArray(Object.create($x))]', only=lambda k: k.isarray),
    D('length read-only', '(Object.defineProperty($x, "length", { writable: false }), [tr(() => a.push($V1)), a.length])', only=lambda k: k.isarray),
    D('concat spreadable', '(a[Symbol.isConcatSpreadable] = false, [[].concat(a).length, [0].concat(a).length])', only=lambda k: k.isarray),
    D('species', '(a.constructor = { [Symbol.species]: function (n: number) { return { made: n }; } }, Object.keys(a.map((v: any) => v)))', only=lambda k: k.isarray),
    D('array methods generic', '[Array.prototype.slice.call($x, 1).length, Array.prototype.indexOf.call($x, a[1]), Array.prototype.includes.call($x, a[0])]', only=lambda k: k.isarray),
    D('prototype of a subclass', '(() => { class Sub extends Array { first() { return this[0]; } } Object.setPrototypeOf($x, Sub.prototype); return [a.first() === a[0], a instanceof Sub, Array.isArray($x)]; })()', only=lambda k: k.isarray),
    # methods and accessors patched
    D('own property over a method', '(a[$M] = function () { return "patched"; }, a[$M]())', typed=None, only=cls),
    D('own property over a method, typed', '($x.$m = function () { return 99; }, $x.$m())', only=cls),
    D('define over a method', 'Object.defineProperty($x, $M, { value() { return "defined"; }, configurable: true, writable: true }) === $x', only=cls),
    D('prototype method stored', '(P[$M] = function () { return "patched"; }, a[$M]())', typed=None, only=ins),
    D('prototype method stored, typed', '($C.prototype.$m = function () { return 99; }, $x.$m())', only=ins),
    D('prototype method defined', '(Object.defineProperty(P, $M, { value() { return "defined"; }, configurable: true, writable: true }), a[$M]())', only=ins),
    D('spy on the instance', '(() => { const original = a[$M]; a[$M] = function (this: any, ...args: any[]) { log.push("call"); return original.apply(this, args); }; return a[$M](); })()', pre='const log: unknown[] = [];', post='show(log)', typed=None, only=cls),
    D('spy on the prototype', '(() => { const original = P[$M]; P[$M] = function (this: any, ...args: any[]) { log.push("call"); return original.apply(this, args); }; return a[$M](); })()', pre='const log: unknown[] = [];', post='show(log)', typed=None, only=ins),
    D('spy, restored', '(() => { const original = P[$M]; P[$M] = function () { return "spy"; }; const during = a[$M](); P[$M] = original; return [during, P[$M] === original]; })()', typed=None, only=ins),
    D('spy by descriptor', '(() => { const d: any = Object.getOwnPropertyDescriptor(P, $M); Object.defineProperty(P, $M, { ...d, value() { return "wrapped"; } }); const during = a[$M](); Object.defineProperty(P, $M, d); return during; })()', only=ins),
    D('prototype method deleted', '[delete P[$M], typeof a[$M]]', only=ins),
    D('prototype extended', '(P.extra = function (this: any) { return "extra " + this[$K1]; }, a.extra())', only=ins),
    D('prototype gets a field name', '(P.other = 5, [a.other, Object.keys($x)])', only=ins),
    D('getter replaced by a value, own', 'Object.defineProperty($x, $G, { value: "val", ' + W + ' }) === $x', only=cls),
    D('getter replaced by a value, prototype', '(Object.defineProperty(P, $G, { value: "val", ' + W + ' }), a[$G])', only=ins),
    D('getter replaced by a getter', '(Object.defineProperty(P, $G, { get() { return "other"; }, configurable: true }), a[$G])', only=ins),
    D('getter deleted', '[delete P[$G], a[$G]]', only=ins),
    D('store to a getter', 'tr(() => { a[$G] = 1; return a[$G]; })', only=cls),
    D('prototype frozen', '(Object.freeze(P), [Object.isFrozen(P), tr(() => { P[$M] = 1; return 1; }), tr(() => { a[$M] = 1; return 1; })])', only=ins),
    D('parent of the prototype replaced', '(Object.setPrototypeOf(P, { hello() { return "hi"; } }), a.hello())', only=ins),
    D('constructor property', '[a.constructor === $C, P.constructor === $C, Object.hasOwn(P, "constructor"), (P.constructor = 5, a.constructor)]', only=ins),
]

# Doors, part D: added after the first table (appended, so that the numbers of the earlier cases stay).
required = lambda k: not k.ko and not k.isarray

DOORS_D = [
    # `delete` of a required field that is kept as a reference: it is served.
    D('delete a reference field', 'delete $x$.2', typed=None, only=required),
    D('delete a reference field, computed', 'delete $x[key($K2)]', typed=None, only=required),
    D('Reflect.deleteProperty of a reference field', 'Reflect.deleteProperty($x, $K2)', only=required),
    D('delete a reference field, in, read', '(delete a[$K2], [$K2 in $x, Object.hasOwn($x, $K2), a[$K2], Object.keys($x), JSON.stringify($x)])', typed=None, only=required),
    D('delete a reference field, add again', '(delete a[$K2], a[$K2] = $V2, [Object.keys($x), a[$K2]])', typed=None, only=required),
    D('prototype behind a deleted reference field', '(Object.setPrototypeOf($x, { [$K2]: $V2 }), delete a[$K2], a[$K2])', typed=None, only=lambda k: required(k) and not k.isfn),
    # attributes of the reference field
    D('define read-only, the other field stored', '(Object.defineProperty($x, $K2, { writable: false }), tr(() => { a[$K1] = $V1; return a[$K1]; }))'),
    D('define getter over the reference field', 'Object.defineProperty($x, $K2, { get() { return $V2; }, enumerable: true, configurable: true }) === $x'),
    D('define not enumerable, JSON, spread, assign', '(Object.defineProperty($x, $K2, { enumerable: false }), [JSON.stringify($x), { ...$x }, Object.assign({}, $x), Object.keys($x), Object.getOwnPropertyNames($x)])', only=notfn),
    D('read-only, then freeze tests', '(Object.defineProperty($x, $K1, { writable: false, configurable: false }), Object.defineProperty($x, $K2, { writable: false, configurable: false }), Object.preventExtensions($x), [Object.isFrozen($x), Object.isSealed($x)])', only=obj),
    D('seal, then read-only one', '(Object.seal($x), Object.defineProperty($x, $K1, { writable: false }), [Object.isFrozen($x), Object.isSealed($x)])', only=obj),
]

DOORS = DOORS_A + DOORS_B + DOORS_C + DOORS_D
PRELUDE = '''// Generated by external-sources-of-typed-objects.py.
const hide = (v: unknown): any => v;
const key = (s: string) => s + "";
const sym = Symbol("sym");
let notes: string[] = [];
function show(v: any, depth = 0): string {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string") return JSON.stringify(v);
    if (t === "function") return "fn";
    if (t === "symbol") return "symbol";
    if (t !== "object") return Object.is(v, -0) ? "-0" : String(v);
    if (depth > 3) return "..";
    if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i ? "," : "") + (i in v ? show(v[i], depth + 1) : "hole"); return s + "]"; }
    let s = "{"; for (const k of Object.keys(v)) s += (s.length > 1 ? "," : "") + k + ":" + show(v[k], depth + 1); return s + "}";
}
function nameOf(e: unknown): string { return e instanceof Error ? e.name : "thrown " + typeof e; }
function tr(f: () => unknown): string { try { return show(f()); } catch (e) { notes.push(String(e)); return "!" + nameOf(e); } }
function own(v: any): string {
    return Reflect.ownKeys(v).map(k => { const d: any = Object.getOwnPropertyDescriptor(v, k); const data = "value" in d;
        return String(k) + ":" + (data ? (d.writable ? "w" : "-") : "a") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-") + (data ? "=" + show(d.value) : ""); }).join(" ");
}
function raw(f: () => string): string { try { return f(); } catch (e) { notes.push(String(e)); return "!" + nameOf(e); } }
function st(a: any, P: any): string { return raw(() => own(a)) + " " + raw(() => (Object.isExtensible(a) ? "E" : "-") + (Object.isSealed(a) ? "S" : "-") + (Object.isFrozen(a) ? "F" : "-") + (Object.getPrototypeOf(a) === P ? "P" : "-")); }
function attempt(id: string, f: () => string) { notes = []; let s: string; try { s = f(); } catch (e) { s = "THROWS !" + nameOf(e); notes.push(String(e)); } console.log(id + ": " + s); for (const n of notes) console.log("#" + id + ": " + n); }
'''
def access(k): return '[%s]' % k if k.isdigit() else '.' + k
def fill(text, k, n, x):
    q = json.dumps
    for a, b in (('$K1', q(k.k1)), ('$K2', q(k.k2)), ('$KO', q(k.ko or '')), ('$M', q(k.m or '')), ('$G', q(k.g or '')), ('$V1', k.v1), ('$V2', k.v2), ('$WRONG', k.wrong), ('$C', k.C or ''),
                 ('$N', str(n)), ('$.1', access(k.k1)), ('$.2', access(k.k2)), ('$.o', access(k.ko or 'none')), ('$k1', k.k1), ('$ko', k.ko or ''), ('$m', k.m or ''), ('$g', k.g or ''), ('$x', x)):
        text = text.replace(a, b)
    return text
cases = []; n = 0
for d in DOORS:
    for make in KINDS:
        for mode in ('any', 'typed'):
            n += 1; k = make(n)
            if d['only'] and not d['only'](k): continue
            e = d['any'] if mode == 'any' or d['typed'] == 'same' else d['typed']
            if e is None: continue
            ident = '%s / %s / %s' % (d['name'], k.name, mode)
            see = 'function see%d(o: T%d): string { return [%s].join(","); }' % (n, n, ', '.join('tr(() => %s)' % r for r in k.reads))
            put = 'function put%d(o: T%d): string { return [%s].join(","); }' % (n, n, ', '.join('tr(() => { %s; return 1; })' % s for s in k.stores))
            post = (' + " | post " + show(%s)' % fill(d['post'], k, n, 'x')) if d['post'] else ''
            body = ('attempt(%s, () => { const o = %s; const a: any = hide(o); const P: any = Object.getPrototypeOf(a); const x%s; %s\n    const r = tr(() => %s);\n'
                    '    return r + " | " + see%d(o) + " | " + st(a, P) + " | put " + put%d(o) + " | " + see%d(o) + " | " + st(a, P)%s; });'
                    % (json.dumps(ident), k.mk, ': any = a' if mode == 'any' else ' = o', fill(d['pre'], k, n, 'x'), fill(e, k, n, 'x'), n, n, n, post))
            cases.append((ident, d['allowed'], '\n'.join((k.decl, see, put, body))))
per = 120
if len(sys.argv) > 1:
    first = (int(sys.argv[1]) - 1) * per
    sys.stdout.write(PRELUDE + '\n'.join(c[2] for c in cases[first:first + per]) + '\nexport {};\n')
else:
    for c in cases: print(c[0])
