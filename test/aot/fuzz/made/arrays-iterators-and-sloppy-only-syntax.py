#!/usr/bin/env python3
"""arrays-iterators-and-sloppy-only-syntax.py <folder>: ONE CASE A FOLDER: programs pointed at: the length of an array stored by name in untyped code . reads at negative indices . whether an object has an index . iterators of the engine that a program steps by hand . what a loop indexes below its length . functions got at by side roads . what only strict code may not say (`with`, octal literals, duplicate parameters, mapped arguments, `delete` of a name, functions in blocks ..) . 16-bit strings . groups of a regular expression that may match nothing . constructors that meet setters."""
import os, sys

out = sys.argv[1]
cases = {}
H = """const say = f => { try { const v = f(); return typeof v === 'string' ? JSON.stringify(v) : typeof v === 'symbol' ? v.toString() : Array.isArray(v) ? '[' + Array.from({ length: Math.min(v.length, 8) }, (x, i) => i in v ? String(v[i]) : '-').join() + ']#' + v.length : String(v); } catch (e) { return 'THROWS ' + e.name; } };
const line = (name, ...fs) => console.log(name + ': ' + fs.map(say).join(' | '));
"""

# ---- arr.length = n in untyped code
cases["array-length-stored"] = {"main.js": H + """function setLength(a, n) { a.length = n; return a; }
function strictSet(a, n) { 'use strict'; a.length = n; return a; }
for (let i = 0; i < 300; i++) { setLength([1, 2, 3], i % 5); strictSet([], i % 3); }
const values = [0, 1, 2, 5, -0, -1, 1.5, NaN, Infinity, 4294967295, 4294967296, '2', '', ' 3 ', 'x', null, undefined, true, false, [], [2], {}, { valueOf() { return 1; } }, { toString() { return '2'; } }, 2n, Symbol('s')];
const makers = { plain: () => [1, 2, 3], empty: () => [], holes: () => [1, , 3], doubles: () => [1.5, 2.5, 3.5], mixed: () => [1, 'a', {}], big: () => { const a = []; a[5000] = 1; return a; }, sparse: () => { const a = [1]; a[100000] = 2; return a; },
  frozen: () => Object.freeze([1, 2, 3]), sealed: () => Object.seal([1, 2, 3]), closed: () => Object.preventExtensions([1, 2, 3]), fixedLength: () => Object.defineProperty([1, 2, 3], 'length', { writable: false }),
  pinned: () => Object.defineProperty([1, 2, 3], 1, { value: 9, configurable: false }), getter: () => Object.defineProperty([1, 2, 3], 0, { get() { return 7; }, configurable: true }), literalCopy: () => { const f = () => [1, 2, 3]; f(); return f(); } };
for (const [name, make] of Object.entries(makers)) for (const f of [setLength, strictSet]) console.log(name, f.name, values.map(v => say(() => f(make(), v))).join(' | '));
class Sub extends Array {} line('subclass', () => setLength(Sub.from([1, 2, 3]), 1), () => setLength(new Sub(), 2) instanceof Sub);
line('not arrays', () => JSON.stringify(setLength({ length: 1 }, 5)), () => setLength(new Uint8Array(3), 1).length, () => strictSet(new Uint8Array(3), 1).length, () => setLength('abc', 1), () => strictSet('abc', 1), () => (function () { setLength(arguments, 1); return arguments.length + ':' + arguments[1]; })(1, 2, 3), () => setLength(function f(a, b) {}, 5).length, () => strictSet(function f(a, b) {}, 5).length);
line('a proxy', () => { const log = []; const p = new Proxy([1, 2, 3], { set(t, k, v, r) { log.push(String(k) + '=' + v); return Reflect.set(t, k, v, r); }, defineProperty(t, k, d) { log.push('define ' + String(k)); return Reflect.defineProperty(t, k, d); } }); setLength(p, 1); return log.join() + ' ' + p.length; });
line('order', () => { const log = []; const a = Object.freeze([1]); try { strictSet(a, { valueOf() { log.push('valueOf'); return 0; } }); } catch (e) { log.push(e.name); } return log.join(); }, () => { const log = []; try { setLength([1, 2], { valueOf() { log.push('v'); return -1; } }); } catch (e) { log.push(e.name); } return log.join(); });
line('grown then read', () => { const a = setLength([], 3); return [a.length, 0 in a, a[0], a.push(1), a.length].join(); }, () => { const a = setLength([1, 2, 3], 0); a.push(9); return a; }, () => { const a = [1, 2, 3]; const it = a[Symbol.iterator](); it.next(); setLength(a, 1); return JSON.stringify(it.next()); });
"""}

# ---- negative index
cases["array-negative-index-read"] = {"main.js": H + """function at(a, i) { return a[i]; }
for (let i = 0; i < 300; i++) at([1, 2, 3], -1 - (i % 3));
const own = [1, 2, 3]; own[-1] = 'own minus one'; own['-2'] = 'own minus two';
const inherits = Object.setPrototypeOf([1, 2, 3], Object.create(Array.prototype, { '-1': { value: 'inherited', configurable: true } }));
const getter = Object.defineProperty([1, 2, 3], '-1', { get() { return 'got'; }, configurable: true });
class Sub extends Array { get [-1]() { return 'of the class'; } }
const keys = [-1, -2, -3, -0, '-1', '-0', -1.5, -Infinity, -2147483648, -2147483649, -4294967296];
for (const [name, a] of Object.entries({ plain: [1, 2, 3], empty: [], holes: [, 1], doubles: [1.5], own, inherits, getter, sub: Sub.from([1]), frozen: Object.freeze([1]), typedArray: new Int8Array([1, 2]), string: 'ab', args: (function () { return arguments; })(1), object: { '-1': 'o' }, proxy: new Proxy([1], { get(t, k) { return typeof k === 'string' ? 'trap ' + k : t[k]; } }) })) console.log(name, keys.map(k => say(() => at(a, k))).join(' | '));
line('later', () => { const a = [1]; const before = at(a, -1); a[-1] = 5; return before + ',' + at(a, -1); }, () => { const a = [1]; at(a, -1); delete a[-1]; Object.defineProperty(a, -1, { value: 6 }); return at(a, -1); });
"""}

# ---- has an index
cases["has-an-index"] = {"main.js": H + """function has(o, i) { return i in o; }
function own(o, i) { return Object.prototype.hasOwnProperty.call(o, i); }
function hasOwn(o, i) { return Object.hasOwn(o, i); }
for (let i = 0; i < 300; i++) { has([1, 2, 3], i % 5); own([1, , 3], i % 4); hasOwn([1], i % 2); }
const keys = [0, 1, 2, 3, -0, -1, 1.5, '0', '1', '01', '1.0', '-0', ' 1', 4294967294, 4294967295, 4294967296, NaN, 'length', null, undefined, true, { toString() { return '1'; } }, Symbol.iterator];
const child = Object.setPrototypeOf([, , 3], Object.setPrototypeOf([7, 8], Array.prototype));
const things = { plain: [1, 2, 3], holes: [1, , 3], empty: [], doubles: [1.5, , 2.5], undefinedInside: [undefined, undefined], child, sparse: (() => { const a = []; a[4294967294] = 1; return a; })(), frozen: Object.freeze([1, , 3]), getter: Object.defineProperty([], 1, { get() { return 1; } }),
  typed: new Uint8Array(2), floats: new Float64Array(2), string: new String('ab'), args: (function () { delete arguments[1]; return arguments; })(1, 2, 3), object: { 0: 'a', 2: 'c' }, nullProto: Object.assign(Object.create(null), { 1: 1 }), fn: Object.assign(function () {}, { 0: 1 }), map: new Map([[0, 1]]),
  proxy: new Proxy([1], { has(t, k) { return k === '1' || k in t; }, getOwnPropertyDescriptor(t, k) { return Reflect.getOwnPropertyDescriptor(t, k); } }) };
for (const [name, o] of Object.entries(things)) for (const f of [has, own, hasOwn]) console.log(name, f.name, keys.map(k => { const s = say(() => f(o, k)); return s === 'true' ? '1' : s === 'false' ? '0' : s; }).join(''));
line('primitives', () => has('ab', 0), () => own('ab', 0), () => own('ab', 2), () => hasOwn('ab', 1), () => has(5, 0), () => own(5, 0), () => own(null, 0), () => hasOwn(undefined, 0));
line('after a change', () => { const a = [1, 2, 3]; const r = [has(a, 1)]; delete a[1]; r.push(has(a, 1)); a.length = 1; r.push(has(a, 2), has(a, 0)); a[2] = 1; r.push(has(a, 2), has(a, 1)); return r.join(); }, () => { const b = new ArrayBuffer(8, { maxByteLength: 16 }); const t = new Uint8Array(b); const r = [has(t, 7), has(t, 8)]; b.resize(16); r.push(has(t, 8)); b.resize(2); r.push(has(t, 7), own(t, 1)); return r.join(); }, () => { const t = new Uint8Array(4); structuredClone(t.buffer, { transfer: [t.buffer] }); return [has(t, 0), own(t, 0), hasOwn(t, 0)].join(); });
"""}

# ---- an engine's iterator handed out and stepped by the program
cases["engine-iterators-stepped-by-hand"] = {"main.js": H + """const show = r => r.done + ':' + (Array.isArray(r.value) ? '[' + r.value.join() + ']' : String(r.value));
function step(it) { return it.next(); }
function drain(it, limit) { const got = []; for (let i = 0; i < limit; i++) got.push(show(step(it))); return got.join(' '); }
for (let i = 0; i < 300; i++) { step([1, 2][Symbol.iterator]()); step(new Map([[1, 2]]).entries()); step(new Set([1]).values()); step('ab'[Symbol.iterator]()); }
const makers = { values: () => [1, 2].values(), keys: () => [1, , 3].keys(), entries: () => ['a', 'b'].entries(), holes: () => [1, , 3][Symbol.iterator](), empty: () => [][Symbol.iterator](), typed: () => new Uint8Array([5, 6]).values(), typedEntries: () => new Float32Array([1.5]).entries(),
  map: () => new Map([[1, 'a'], [2, 'b']])[Symbol.iterator](), keysOfMap: () => new Map([[1, 'a']]).keys(), valuesOfMap: () => new Map([[1, 'a']]).values(), set: () => new Set([1, 2]).values(), entriesOfSet: () => new Set(['x']).entries(), string: () => 'a\\u{1F600}b'[Symbol.iterator](), halfOfAPair: () => '\\uD83Dx'[Symbol.iterator](),
  args: () => (function () { return arguments[Symbol.iterator](); })(1, 2), matchAll: () => 'a1b2'.matchAll(/\\d/g), arrayLike: () => Array.prototype.values.call({ length: 2, 0: 'x', 1: 'y' }), ofString: () => Array.prototype.values.call('hi'), segments: () => new Intl.Segmenter('en').segment('ab')[Symbol.iterator](), helper: () => [1, 2, 3].values().map(x => x * 2), generator: () => (function* () { yield 1; return 2; })() };
for (const [name, make] of Object.entries(makers)) console.log(name, say(() => drain(make(), 4)).slice(0, 200));
line('changed on the way', () => { const a = [1, 2, 3]; const it = a.values(); step(it); a.length = 1; return drain(it, 2) + ' then ' + (a.push(5, 6), drain(it, 2)); }, () => { const a = [1]; const it = a.values(); step(it); a.push(2); return drain(it, 3); }, () => { const m = new Map([[1, 1], [2, 2], [3, 3]]); const it = m.keys(); step(it); m.delete(2); m.set(4, 4); return drain(it, 4); }, () => { const s = new Set([1, 2]); const it = s.values(); step(it); s.clear(); s.add(9); return drain(it, 3); }, () => { const m = new Map([[1, 1]]); const it = m.entries(); drain(it, 2); m.set(2, 2); return drain(it, 2); });
line('a buffer that goes', () => { const t = new Uint8Array(4); const it = t.values(); step(it); structuredClone(t.buffer, { transfer: [t.buffer] }); return drain(it, 1); }, () => { const b = new ArrayBuffer(4, { maxByteLength: 8 }); const t = new Uint8Array(b); const it = t.values(); step(it); b.resize(1); return drain(it, 2); });
line('the wrong receiver', () => [].values().next.call({}), () => [].values().next.call(new Map().keys()), () => new Map().keys().next.call([].values()), () => new Set().values().next.call(new Map().values()), () => ''[Symbol.iterator]().next.call([].values()), () => [].values().next.call(undefined), () => { const next = [7].values().next; return show(next.call([8].values())); });
line('what it is', () => { const it = [].values(); return [typeof it.next, it[Symbol.iterator]() === it, Object.prototype.toString.call(it), 'return' in it, Object.getOwnPropertyNames(it).length].join(); }, () => Object.prototype.toString.call(new Map().entries()), () => { const r = step([1].values()); return Object.keys(r).join() + Object.isFrozen(r); }, () => { const it = [1, 2].values(); const a = step(it), b = step(it); return a === b; }, () => { const it = new Map([[1, 2]]).entries(); const a = step(it).value; a[0] = 9; return a.join(); });
line('own next laid over', () => { const it = [1, 2].values(); it.next = () => ({ done: false, value: 'mine' }); return show(step(it)) + ' ' + [...{ [Symbol.iterator]: () => ({ n: 0, next() { return { done: this.n++ > 1, value: this.n }; } }) }].join(); });
"""}

# ---- what a loop indexes below its length
cases["a-loop-below-its-length"] = {"main.js": H + """function sum(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
function join(a) { let s = ''; for (let i = 0; i < a.length; i++) s += '<' + String(a[i]) + '>'; return s; }
function fill(a, v) { for (let i = 0; i < a.length; i++) a[i] = v; return a; }
function down(a) { let s = ''; for (let i = a.length - 1; i >= 0; i--) s += String(a[i]); return s; }
for (let i = 0; i < 300; i++) { sum([1, 2, 3]); join(['a']); fill([0, 0], 1); down([1]); }
const likes = { array: () => [1, 2, 3], holes: () => [1, , 3], doubles: () => [0.5, 1.5], strings: () => ['a', 'b'], string: () => 'abc', wide: () => 'a\\u0416\\u{1F600}', boxed: () => new String('xy'), typed: () => new Int16Array([1, -2]), clamped: () => new Uint8ClampedArray([250, 251]), big: () => new BigInt64Array([1n, 2n]), args: () => (function () { return arguments; })(4, 5),
  like: () => ({ length: 2, 0: 'p', 1: 'q' }), fraction: () => ({ length: 1.5, 0: 1, 1: 2 }), text: () => ({ length: '2', 0: 1, 1: 2 }), negative: () => ({ length: -1, 0: 1 }), none: () => ({}), fn: () => function(a, b) {}, getter: () => { let n = 0; return { get length() { return n++ < 3 ? 2 : 0; }, 0: 'g', 1: 'h' }; }, shrinks: () => { const a = [1, 2, 3, 4]; Object.defineProperty(a, 1, { get() { a.length = 2; return 20; } }); return a; },
  proxy: () => new Proxy([1, 2], { get(t, k, r) { return k === '1' ? 'trapped' : Reflect.get(t, k, r); } }), frozen: () => Object.freeze([1, 2]), sub: () => (class S extends Array {}).from([6, 7]), nodeBuffer: () => Buffer.from('hi'), nil: () => null, undef: () => undefined, number: () => 5 };
for (const [name, make] of Object.entries(likes)) line(name, () => sum(make()), () => join(make()), () => down(make()), () => { const x = fill(make(), 7); return typeof x === 'object' && x !== null ? join(x) : x; });
"""}

# ---- a function called by value though no closure of it was seen to be handed out
cases["functions-got-at-by-side-roads"] = {"main.cjs": H + """function callerOf() { return callerOf.caller; }
function direct() { return callerOf(); }
function viaCallee() { return arguments.callee; }
function named() { return (function self() { return self; })(); }
function Ctor() { this.made = new.target; }
class Base { who() { return this.constructor; } static me() { return this; } }
class Derived extends Base { up() { return Object.getPrototypeOf(Derived); } }
function hoisted() { return 'hoisted'; }
const obj = { method() { return 'method'; }, get got() { return 'got'; }, ['comp' + 'uted']() { return 'computed'; } };
function only_direct_a(x) { return x + 1; } function only_direct_b(x) { return only_direct_a(x) * 2; }
for (let i = 0; i < 300; i++) { only_direct_b(i); }
line('callee', () => viaCallee() === viaCallee, () => viaCallee()() === viaCallee, () => viaCallee.call(1).name);
line('self', () => typeof named(), () => named().name, () => named()() === named(), () => typeof named()()());
line('new.target', () => new Ctor().made === Ctor, () => new (new Ctor().made)().made.name, () => Reflect.construct(Ctor, [], Base).made === Base);
line('constructor', () => new Derived().who() === Derived, () => new (new Derived().who())().who().name, () => Derived.me() === Derived, () => new Derived().up() === Base, () => new (new Derived().up())().who().name);
line('by a name made at run time', () => globalThis['hoi' + 'sted'] === undefined ? 'module scope' : globalThis['hoi' + 'sted'](), () => obj['meth' + 'od'](), () => obj['computed'](), () => Object.getOwnPropertyDescriptor(obj, 'got').get.call(obj), () => Object.values(obj).filter(f => typeof f === 'function').map(f => f()).join());
line('by eval and Function', () => (0, eval)('typeof hoisted'), () => eval('only_direct_a')(1), () => eval('only_direct_b(2)'), () => new Function('f', 'return f(3)')(only_direct_b));
line('by the stack', () => { const keep = Error.prepareStackTrace; try { Error.prepareStackTrace = (e, sites) => sites.map(s => typeof s.getFunction === 'function' ? typeof s.getFunction() : 'none').slice(0, 2).join(); return String(new Error('x').stack).slice(0, 40); } finally { Error.prepareStackTrace = keep; } });
line('apply, call, bind, Reflect', () => only_direct_a.call(null, 1), () => only_direct_a.apply(null, [2]), () => only_direct_a.bind(null, 3)(), () => Reflect.apply(only_direct_a, null, [4]), () => [1, 2].map(only_direct_a).join(), () => Function.prototype.call.call(only_direct_a, null, 5), () => Function.prototype.call.bind(only_direct_a)(null, 6));
line('as data', () => JSON.stringify({ f: only_direct_a }), () => String(only_direct_a).length > 10, () => only_direct_a.name + only_direct_a.length, () => new Map([[only_direct_a, 1]]).get(only_direct_a), () => typeof structuredClone.call(null, 1), () => { const w = new WeakRef(only_direct_b); return w.deref()(1); });
"""}

# ---- what only strict code may not say
SLOPPY = {
    "octal-literals": "line('octal', () => 010, () => 0777, () => 09, () => 08.5, () => '\\\\101'.length, () => '\\101', () => '\\0', () => '\\08', () => 010 .toString());",
    "delete-of-a-name": "var v = 1; let l = 2; function f() {} globalThis.g = 3; line('delete', () => delete v, () => delete l, () => delete f, () => delete g, () => typeof g, () => delete nothing, () => { var inner = 1; return delete inner; }, () => (function (p) { return delete p; })(1), () => delete this, () => delete 1);",
    "duplicate-parameters": "function d(a, a) { return a; } function e(a, b, a) { return [a, b, arguments.length, arguments[0]].join(); } line('duplicates', () => d(1, 2), () => d(1), () => e(1, 2, 3), () => e(1, 2), () => d.length, () => new Function('a', 'a', 'return a')(1, 2));",
    "assigning-undeclared-names": "function set() { fresh = 5; return fresh; } line('undeclared', () => typeof fresh, () => set(), () => typeof fresh, () => globalThis.fresh, () => delete globalThis.fresh, () => typeof fresh, () => { other = 1; return Object.getOwnPropertyDescriptor(globalThis, 'other').configurable; });",
    "eval-and-arguments-as-names": "function a(eval) { return eval; } function b(arguments) { return arguments; } function c() { var arguments = 5; return arguments; } function d() { arguments = 6; return arguments; } function e() { var eval = 7; return eval; } line('names', () => a(1), () => b(2), () => c(), () => d(), () => e(), () => { var yield_ = 1, let_ = 2; var yield = 3; var static = 4, implements = 5, interface = 6, package = 7, private = 8, protected = 9, public = 10; return yield + static + implements + interface + package + private + protected + public; }, () => { var let = 11; return let; });",
    "mapped-arguments": "function m(a, b) { arguments[0] = 'changed'; b = 'stored'; return [a, arguments[1], arguments.length].join(); } function n(a) { a = 2; return arguments[0]; } function o(a) { delete arguments[0]; arguments[0] = 5; return a; } function p(a = 1) { a = 2; return arguments[0]; } function q(a) { Object.defineProperty(arguments, 0, { writable: false }); a = 9; return arguments[0]; } line('mapped', () => m(1, 2), () => m(1), () => n(1), () => n(), () => o(1), () => p(1), () => q(1));",
    "this-is-the-global-or-a-wrapper": "function t() { return this; } function u() { return typeof this; } line('this', () => t() === globalThis, () => t.call(undefined) === globalThis, () => t.call(null) === globalThis, () => u.call(5), () => u.call('s'), () => u.call(true), () => t.call(5) instanceof Number, () => u.call(Symbol()), () => u.call(1n), () => [1].map(u).join(), () => (0, t)() === globalThis);",
    "with": "const scope = { x: 1, f() { return this === scope; } }; var x = 'outer'; line('with', () => { with (scope) { return x; } }, () => { with (scope) { x = 2; } return scope.x + ':' + x; }, () => { with (scope) { return f(); } }, () => { with (scope) { var y = 5; } return y + ':' + ('y' in scope); }, () => { with ({ [Symbol.unscopables]: { x: true }, x: 'hidden' }) { return x; } }, () => { with (null) {} }, () => { with (5) { return toFixed(1); } }, () => { with ([1, 2]) { return length; } });",
    "functions-in-blocks": "line('blocks', () => { const before = typeof inBlock; { function inBlock() { return 1; } } return before + ':' + typeof inBlock; }, () => { if (true) function viaIf() { return 2; } return viaIf(); }, () => { { function twice() { return 'a'; } } { function twice() { return 'b'; } } return twice(); }, () => { let r = typeof later; if (false) { function later() {} } return r + ':' + typeof later; }, () => { label: function labelled() { return 3; } return labelled(); }, () => { switch (1) { case 1: function inSwitch() { return 4; } } return inSwitch(); });",
    "stores-that-fail-in-silence": "const frozen = Object.freeze({ a: 1 }), getterOnly = { get g() { return 1; } }, closed = Object.preventExtensions({}); line('silence', () => { frozen.a = 2; return frozen.a; }, () => { frozen.b = 2; return frozen.b; }, () => delete frozen.a, () => { getterOnly.g = 5; return getterOnly.g; }, () => { closed.n = 1; return closed.n; }, () => { 'abc'.length = 1; return 'ok'; }, () => { 'abc'[0] = 'x'; return 'ok'; }, () => { (5).p = 1; return 'ok'; }, () => { undefined = 1; return typeof undefined; }, () => { NaN = 1; Infinity = 2; return NaN + ':' + Infinity; }, () => { const f = function g() { g = 1; return typeof g; }; return f(); });",
    "caller-and-arguments-of-functions": "function outer() { return inner(); } function inner() { return [inner.caller === outer, inner.arguments.length, outer.arguments.length, typeof inner.caller].join(); } line('caller', () => outer(1, 2), () => inner.caller, () => inner.arguments, () => Object.getOwnPropertyNames(inner).sort().join(), () => (function () { 'use strict'; return Object.getOwnPropertyNames(function () {}).sort().join(); })(), () => (() => 1).caller, () => (function () { 'use strict'; }).caller);",
    "html-comments-and-legacy-syntax": "var r = [];\\nr.push(1); <!-- a comment\\n--> another\\nr.push(2);\\nline('legacy', () => r.join(), () => { var a = 1; a\\n++\\na; return a; }, () => { for (var i = 0 in {}) ; return i; }, () => /[\\\\c]/.test('c'), () => /\\\\1(a)/.exec('a')[0], () => /a{,2}/.test('a{,2}'), () => /\\\\8/.test('8'), () => escape('a b') + unescape('%41'), () => 'x'.anchor('y'), () => new Date(0).getYear());",
}
for name, body in SLOPPY.items():
    cases["sloppy-" + name] = {"main.cjs": H + body + "\n"}

# ---- 16-bit strings
cases["sixteen-bit-strings"] = {"main.ts": """declare const console: { log(...v: unknown[]): void };
const say = (f: () => unknown): string => { try { const v = f(); return typeof v === "string" ? JSON.stringify(v) : String(v); } catch (e) { return "THROWS " + (e as Error).name; } };
const line = (name: string, ...fs: (() => unknown)[]): void => console.log(name + ": " + fs.map(say).join(" | "));
interface Row { name: string; tags: string[]; note?: string }
const texts: string[] = ["", "a", "abc", "\\u00e9", "\\u00ff", "\\u0100", "\\u0416\\u0416", "a\\u0416", "\\u0416a", "\\u{1F600}", "a\\u{1F600}b", "\\uD83D", "\\uDE00", "\\uDE00\\uD83D", "\\u2028\\u2029", "\\uFEFF", "\\uFFFF", "\\u0000", "\\u0130", "\\u00df", "\\ufb01", "\\u03a3", "\\u1e9e", "e\\u0301"];
function ops(s: string, t: string): string { return [s.length, s + t, s < t, s === t, s.indexOf(t), s.lastIndexOf(t), s.includes(t), s.startsWith(t), s.endsWith(t), s.charCodeAt(0), s.codePointAt(0), s.at(-1), s.slice(1), s.substring(0, 1), s.padStart(3, t), s.padEnd(3, t), s.repeat(2), s.split(t).length, s.replace(t, "-"), s.replaceAll(t || "x", "+"), s.localeCompare(t), s.concat(t, s), s.trim().length, s.toUpperCase(), s.toLowerCase(), s.normalize("NFC").length, s.normalize("NFD").length, s.isWellFormed(), s.toWellFormed().length, [...s].length].map(v => typeof v === "string" ? JSON.stringify(v) : String(v)).join(","); }
let digest = 0; const mix = (s: string): void => { for (let i = 0; i < s.length; i++) digest = (Math.imul(digest, 31) + s.charCodeAt(i)) | 0; };
for (const s of texts) { for (const t of texts) mix(say(() => ops(s, t))); console.log(JSON.stringify(s), digest); }
for (const s of texts) line(JSON.stringify(s), () => JSON.stringify({ name: s, tags: [s, s + "x"], note: s } as Row), () => (JSON.parse(JSON.stringify({ name: s, tags: [s] })) as Row).name === s, () => JSON.stringify({ [s]: 1 }), () => new Map([[s, 1]]).get(s + ""), () => new Set([s, s + "", (s + "x").slice(0, -1)]).size, () => ({ [s]: 2 } as Record<string, number>)[(s + "y").slice(0, -1)], () => encodeURIComponent(s), () => new TextEncoder().encode(s).length, () => new TextDecoder().decode(new TextEncoder().encode(s)) === s, () => Symbol(s).description === s, () => Symbol.for(s) === Symbol.for((s + "z").slice(0, -1)), () => `${s}:${s.length}`, () => Number(s), () => parseInt(s + "1"), () => s.match(/./u)?.[0], () => s.match(/./)?.[0], () => /^\\w*$/.test(s), () => /^\\p{L}*$/u.test(s), () => s.search(/\\u0416/), () => btoa(s));
"""}

# ---- a group that may match nothing, under a fixed count
cases["regexp-groups-that-may-match-nothing"] = {"main.js": H + """const sources = ['(a*){2}', '(a*){3}b', '(?:a*){2}', '(a?){3}', '(a?){3}a', '(a*?){2}', '(a*){0}', '(a*){1}', '(a*){2,2}', '(a*){2,3}', '(a*){2,}', '(a|){3}', '(|a){3}', '(a*|b){3}', '((a*)b*){2}', '((a)|){2}', '(a*)*', '(a*)+', '(?:(a)|b*){3}', '(?:(a)|(b)|){3}', '(\\\\b){2}', '(^){2}a', '($){2}', '(?=a){2}a', '(?:(?=a)){3}a', '(?!b){2}a', '(a*){2}\\\\1', '(?:(a*)\\\\1){2}', '(?<n>a*){2}\\\\k<n>', '(a{0}){3}', '(a{0,1}){2}', '([ab]*){2}c', '(.*){2}', '(.*?){2}x', '(\\\\d*){4}', '(\\\\s*){2}\\\\S', '(a*){10}', '(a*){100}', '(?:a*b*){3}c', '(x*)(y*){2}(z*)', '(?:){5}', '(){3}', '(()){2}', '(()|a){2}', '(a*){2}$', '^(a*){2}$', '(?:(a*){2}){2}', '(?<=(a*){2})b', '(?<!(a*){2}c)b'];
const flags = ['', 'g', 'i', 'u', 'y', 'm', 's', 'd', 'v', 'gi'];
const inputs = ['', 'a', 'aa', 'aaa', 'aaaa', 'b', 'ab', 'aab', 'ba', 'aba', 'abab', 'c', 'abc', 'xyz', 'xx yy', '12 34', 'AAA', 'a\\nb', '\\u{1F600}a'];
const show = m => m === null ? 'null' : m.index + ':' + Array.from(m, x => x === undefined ? '~' : JSON.stringify(x)).join(',') + (m.groups ? JSON.stringify(m.groups) : '') + (m.indices ? JSON.stringify(m.indices) : '');
let all = 0; const mix = s => { for (let i = 0; i < s.length; i++) all = (Math.imul(all, 31) + s.charCodeAt(i)) | 0; };
for (const source of sources) { let digest = ''; for (const f of flags) { let part = ''; for (const input of inputs) part += say(() => { const r = new RegExp(source, f); const first = show(r.exec(input)); return first + '@' + r.lastIndex + ';' + show(r.exec(input)) + ';' + input.replace(r, '[$&|$1]') + ';' + input.split(r).length + ';' + r.test(input); }) + '\\n'; mix(part); digest += (all >>> 0).toString(36) + ' '; } console.log(source, digest, say(() => show(new RegExp(source).exec('aab'))), say(() => show(new RegExp(source).exec('')))); }
const literals = [[/(a*){2}/, 'aaa'], [/(a*){3}b/, 'aab'], [/(a?){3}a/, 'aa'], [/(a|){3}/, 'aa'], [/((a)|){2}/, 'a'], [/(?:(a)|b*){3}/, 'abb'], [/(a*){2}\\1/, 'aa'], [/([ab]*){2}c/, 'abc'], [/(?:a*b*){3}c/g, 'aabbc abc c'], [/(\\d*){4}/y, '1234']];
for (let round = 0; round < 200; round++) for (const [r, s] of literals) r.exec(s);
for (const [r, s] of literals) { r.lastIndex = 0; line(String(r), () => show(r.exec(s)), () => s.replace(r, '<$1>'), () => s.match(r).length, () => [...s.matchAll(new RegExp(r.source, 'g'))].map(show).join(' ')); }
"""}

# ---- a constructor copied into its `new` that meets a setter
cases["constructors-that-meet-setters"] = {"main.cjs": H + """const log = [];
class WithSetter { set a(v) { log.push('set a ' + v); this._a = v; } get a() { return this._a; } constructor(a, b) { this.a = a; this.b = b; } }
class Child extends WithSetter { constructor(a, b) { super(a, b); this.c = a + b; } set c(v) { log.push('set c ' + v); this._c = v * 2; } get c() { return this._c; } }
function Old(a) { this.a = a; this.z = 1; } Object.defineProperty(Old.prototype, 'a', { set(v) { log.push('old a ' + v); Object.defineProperty(this, 'a', { value: v + 1, writable: true, configurable: true, enumerable: true }); }, configurable: true });
function GetterOnly(a) { this.a = a; this.ok = true; } Object.defineProperty(GetterOnly.prototype, 'a', { get() { return 'fixed'; }, configurable: true });
function StrictGetterOnly(a) { 'use strict'; this.a = a; this.ok = true; } Object.defineProperty(StrictGetterOnly.prototype, 'a', { get() { return 'fixed'; }, configurable: true });
function ReadOnly(a) { this.a = a; this.ok = true; } Object.defineProperty(ReadOnly.prototype, 'a', { value: 'proto', writable: false, configurable: true });
function Throws(a) { this.before = 1; this.a = a; this.after = 2; } Object.defineProperty(Throws.prototype, 'a', { set(v) { kept = this; throw new RangeError('no'); }, configurable: true }); let kept;
function Later(a) { this.a = a; this.b = 2; }
const makeAll = () => [new WithSetter(1, 2), new Child(1, 2), new Old(5), new GetterOnly(1), new ReadOnly(1), new Later(1)].map(o => JSON.stringify(o) + Object.keys(o).join()).join(' ');
for (let i = 0; i < 300; i++) makeAll(); log.length = 0;
line('made', makeAll, () => log.join()); log.length = 0;
line('strict', () => JSON.stringify(new StrictGetterOnly(1)), () => { try { new Throws(1); } catch (e) { return e.name + JSON.stringify(kept); } });
line('a setter laid later', () => { Object.defineProperty(Later.prototype, 'a', { set(v) { log.push('later ' + v); }, configurable: true }); const o = new Later(7); return JSON.stringify(o) + log.join(); }, () => { delete Later.prototype.a; return JSON.stringify(new Later(8)); }, () => { Object.setPrototypeOf(Later.prototype, { set b(v) { log.push('deep ' + v); } }); const o = new Later(9); return JSON.stringify(o) + log.join(); });
line('the setter changes the shape', () => { function S(a) { this.a = a; this.b = 2; this.c = 3; } Object.defineProperty(S.prototype, 'b', { set(v) { delete this.a; this.extra = v; }, configurable: true }); let last; for (let i = 0; i < 100; i++) last = new S(i); return JSON.stringify(last); }, () => { function R(a) { this.a = a; return; } Object.defineProperty(R.prototype, 'a', { set(v) { this.self = this; }, configurable: true }); const r = new R(1); return r.self === r; }, () => { function P(a) { this.a = a; } P.prototype = new Proxy({}, { set(t, k, v, r) { log.push('proxy ' + String(k)); return Reflect.defineProperty(r, k, { value: v, enumerable: true, writable: true, configurable: true }); } }); log.length = 0; return JSON.stringify(new P(3)) + log.join(); });
"""}

for name, files in cases.items():
    os.makedirs(os.path.join(out, name), exist_ok=True)
    for f, text in files.items():
        with open(os.path.join(out, name, f), "w") as h:
            h.write(text)
print(len(cases), "cases")
