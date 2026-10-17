#!/usr/bin/env python3
"""named-stores-every-object-kind.py: A MATRIX: every one of 60 names is stored through ONE SITE A NAME into a FRESH object of every one of some 60 kinds, so each site meets every kind: own data (first, middle, last, in line and out of line), absent (a transition), read-only own | inherited, a setter own | inherited, a getter alone own | inherited, hidden, frozen | sealed | not extensible, a dictionary, after a delete, no prototype, a prototype that is a proxy, a proxy, arrays, functions, class instances with fields | accessors | private names, boxed and bare primitives, Maps, Dates, errors thrown by setters. After the store: what the store expression gave or threw, the value read back through a site, own keys in order, the descriptor; then a second store over it, a delete and a third store. One line a kind and name group; strict code."""
N = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'x', 'y', 'z', 'id', 'key', 'value', 'type', 'kind', 'next', 'prev', 'left', 'right', 'size', 'count', 'data', 'items', 'first', 'last', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype', 'then', 'get', 'set', 'has', 'push', 'pop', 'map', 'message', 'stack', 'index', 'input', 'done', 'caller', 'callee', 'arguments', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'q299', 'q150', 'q0']
print('"use strict";')
print('const NAMES = %s;' % N)
print('const write = [' + ','.join('(o,v)=>o.%s=v' % n for n in N) + '];')
print('const read = [' + ','.join('o=>o.%s' % n for n in N) + '];')
print('const remove = [' + ','.join('o=>delete o.%s' % n for n in N) + '];')
print(r'''
const show = v => (v === null ? "null" : typeof v === "object" ? (Array.isArray(v) ? "[" + v.length + "]" : "{}") : typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : typeof v + ":" + String(v));
let log = "";
const big = () => { const o = {}; for (let i = 0; i < 300; i++) o["q" + i] = i; return o; };
class Fields { a = 1; x = 2; id = 3; }
class Accessors { #v = 0; get a() { return this.#v; } set a(v) { this.#v = v; log += "S"; } get x() { return "only got"; } set y(v) { log += "Y"; } static z = 1; }
class Heir extends Accessors { b = 1; }
const KINDS = {
  empty: () => ({}), one: () => ({ a: 1 }), abc: () => ({ a: 1, b: 2, c: 3 }), cba: () => ({ c: 3, b: 2, a: 1 }), eight: () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }), words: () => ({ id: 1, key: "k", value: 2, type: "t", kind: "k", next: null, prev: null }),
  twenty: () => ({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, x: 9, y: 10 }), big, grown: () => { const o = {}; o.z = 1; o.y = 2; o.x = 3; o.a = 4; return o; },
  afterDelete: () => { const o = { a: 1, b: 2, c: 3, x: 4 }; delete o.b; return o; }, deletedAll: () => { const o = { a: 1, x: 2 }; delete o.a; delete o.x; return o; }, dictionary: () => { const o = big(); for (let i = 0; i < 290; i++) delete o["q" + i]; o.a = 1; return o; },
  readOnly: () => Object.defineProperty({ b: 1 }, "a", { value: 1, writable: false, enumerable: true, configurable: true }), readOnlyFixed: () => Object.defineProperty({}, "x", { value: 1 }), hidden: () => Object.defineProperty({ b: 1 }, "a", { value: 1, writable: true, enumerable: false, configurable: true }),
  setter: () => ({ b: 1, set a(v) { log += "s" + show(v); }, get a() { return "g"; } }), setterAlone: () => ({ set a(v) { log += "s"; }, set x(v) { throw new RangeError("no"); } }), getterAlone: () => ({ get a() { return 1; }, get id() { return 2; } }),
  frozen: () => Object.freeze({ a: 1, x: 2 }), sealed: () => Object.seal({ a: 1, x: 2 }), closed: () => Object.preventExtensions({ a: 1, x: 2 }), frozenEmpty: () => Object.freeze({}),
  heirOfData: () => Object.create({ a: 1, x: 2, id: 3 }), heirOfReadOnly: () => Object.create(Object.defineProperty({}, "a", { value: 1, writable: false })), heirOfFrozen: () => Object.create(Object.freeze({ a: 1, x: 2 })), heirOfSetter: () => Object.create({ set a(v) { log += "hs" + show(v) + (this === undefined); }, get a() { return "hg"; } }), heirOfGetter: () => Object.create({ get a() { return 1; } }),
  heirTwoUp: () => Object.create(Object.create({ set x(v) { log += "2up"; }, a: 1 })), heirOfProxy: () => Object.create(new Proxy({}, { set(t, k, v, r) { log += "P" + String(k); return Reflect.set(t, k, v, r); } })), heirOfProxyThatRefuses: () => Object.create(new Proxy({}, { set: () => false })),
  noPrototype: () => Object.create(null), noPrototypeWithData: () => Object.assign(Object.create(null), { a: 1, toString: 2 }), proxy: () => new Proxy({ a: 1 }, {}), proxyThatRefuses: () => new Proxy({ a: 1 }, { set: () => false }), proxyThatThrows: () => new Proxy({}, { set() { throw new EvalError("trap"); } }),
  array: () => [1, 2], emptyArray: () => [], arrayWithNames: () => Object.assign([1], { a: 1 }), frozenArray: () => Object.freeze([1]), fn: () => function f(p, q) {}, arrow: () => () => 1, klass: () => class K { static a = 1; }, bound: () => (function () {}).bind(null),
  fields: () => new Fields(), accessors: () => new Accessors(), heir: () => new Heir(), frozenFields: () => Object.freeze(new Fields()), map: () => new Map(), set: () => new Set(), date: () => new Date(0), regexp: () => /x/g, promise: () => Promise.resolve(1), typedArray: () => new Uint8Array(2), weakMap: () => new WeakMap(), symbolBox: () => Object(Symbol.iterator),
  boxedNumber: () => Object(5), boxedString: () => Object("str"), number: () => 5, string: () => "str", boolean: () => true, symbol: () => Symbol.iterator, bigint: () => 5n, nil: () => null, undef: () => undefined, args: () => (function () { Reflect.ownKeys(arguments); return arguments; })(1, 2), json: () => JSON.parse('{"a":1,"x":{"y":2},"id":3}'), spread: () => ({ ...{ a: 1, x: 2 }, b: 3 }), assigned: () => Object.assign({}, { x: 1, a: 2 }), entries: () => Object.fromEntries([["a", 1], ["z", 2]]),
};
const attempt = f => { try { return show(f()); } catch (e) { return "!" + e.name; } };
const keys = o => { try { return o === null || o === undefined ? "-" : Reflect.ownKeys(Object(o)).length > 40 ? "#" + Reflect.ownKeys(Object(o)).length : Reflect.ownKeys(Object(o)).map(String).join(); } catch (e) { return "!" + e.name; } };
const descriptor = (o, n) => { try { const d = Object.getOwnPropertyDescriptor(Object(o), n); return d === undefined ? "none" : (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + ("get" in d ? "A" : ""); } catch (e) { return "!" + e.name; } };
let digest = 0; const note = s => { for (let i = 0; i < s.length; i++) digest = (Math.imul(digest, 31) + s.charCodeAt(i)) | 0; };
for (let round = 0; round < 3; round++) for (const kind of Object.keys(KINDS)) {
  let line = "";
  for (let k = 0; k < NAMES.length; k++) {
    const o = KINDS[kind](); log = "";
    let s = NAMES[k] + "=" + attempt(() => write[k](o, k + 0.5)) + attempt(() => read[k](o)) + descriptor(o, NAMES[k]) + "/" + keys(o);
    s += ";" + attempt(() => write[k](o, "second")) + attempt(() => read[k](o)) + ";" + attempt(() => remove[k](o)) + attempt(() => read[k](o)) + ";" + attempt(() => write[k](o, null)) + attempt(() => read[k](o)) + descriptor(o, NAMES[k]) + "/" + keys(o) + "~" + log;
    line += s + " ";
  }
  digest = 0; note(line); console.log(round + " " + kind + ": " + digest + " " + line.length);
}
console.log("end");
''')
