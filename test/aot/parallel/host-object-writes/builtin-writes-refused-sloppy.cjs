const f = function () {};
const d = { value: f, configurable: true, writable: true };
// prettier-ignore
const cases = [
  [() => globalThis, () => { Array = f; }, "Array = f;"],
  [() => globalThis, () => { globalThis.Array = f; }, "globalThis.Array = f;"],
  [() => globalThis, () => { delete globalThis.Array; }, "delete globalThis.Array;"],
  [() => globalThis, () => { Object.defineProperty(globalThis, "Array", d); }, "Object.defineProperty(globalThis, \"Array\", d);"],
  [() => globalThis, () => { Proxy = f; }, "Proxy = f;"],
  [() => globalThis, () => { globalThis.Proxy = f; }, "globalThis.Proxy = f;"],
  [() => globalThis, () => { delete globalThis.Proxy; }, "delete globalThis.Proxy;"],
  [() => globalThis, () => { Atomics = f; }, "Atomics = f;"],
  [() => globalThis, () => { Uint8Array = f; }, "Uint8Array = f;"],
  [() => globalThis, () => { globalThis.process = f; }, "globalThis.process = f;"],
  [() => globalThis, () => { delete globalThis.process; }, "delete globalThis.process;"],
  [() => Array.prototype, () => { Array.prototype[Symbol.toPrimitive] = f; }, "Array.prototype[Symbol.toPrimitive] = f;"],
  [() => Array.prototype, () => { Array.prototype[Symbol.toStringTag] = "T"; }, "Array.prototype[Symbol.toStringTag] = \"T\";"],
  [() => Object.prototype, () => { Object.prototype[Symbol.toPrimitive] = f; }, "Object.prototype[Symbol.toPrimitive] = f;"],
  [() => Map.prototype, () => { Map.prototype[Symbol.hasInstance] = f; }, "Map.prototype[Symbol.hasInstance] = f;"],
  [() => Function.prototype, () => { Function.prototype.prototype = f; }, "Function.prototype.prototype = f;"],
  [() => Object.prototype, () => { Object.prototype.zzz = f; }, "Object.prototype.zzz = f;"],
  [() => Object.prototype, () => { Object.defineProperty(Object.prototype, "zzz", d); }, "Object.defineProperty(Object.prototype, \"zzz\", d);"],
  [() => Function.prototype, () => { Function.prototype.zzz = f; }, "Function.prototype.zzz = f;"],
  [() => Promise.prototype, () => { Promise.prototype.zzz = f; }, "Promise.prototype.zzz = f;"],
  [() => Array.prototype, () => { Array.prototype.push = f; }, "Array.prototype.push = f;"],
  [() => Array.prototype, () => { delete Array.prototype.push; }, "delete Array.prototype.push;"],
  [() => Array.prototype, () => { Object.defineProperty(Array.prototype, "push", d); }, "Object.defineProperty(Array.prototype, \"push\", d);"],
  [() => Array.prototype, () => { Array.prototype[Symbol.iterator] = f; }, "Array.prototype[Symbol.iterator] = f;"],
  [() => Array.prototype, () => { delete Array.prototype[Symbol.iterator]; }, "delete Array.prototype[Symbol.iterator];"],
  [() => Array.prototype, () => { Array.prototype.constructor = f; }, "Array.prototype.constructor = f;"],
  [() => Array.prototype, () => { Array.prototype.toString = f; }, "Array.prototype.toString = f;"],
  [() => Array.prototype, () => { Array.prototype.hasOwnProperty = f; }, "Array.prototype.hasOwnProperty = f;"],
  [() => Array.prototype, () => { Object.defineProperty(Array.prototype, "hasOwnProperty", d); }, "Object.defineProperty(Array.prototype, \"hasOwnProperty\", d);"],
  [() => Object.prototype, () => { Object.prototype.toString = f; }, "Object.prototype.toString = f;"],
  [() => Object.prototype, () => { delete Object.prototype.hasOwnProperty; }, "delete Object.prototype.hasOwnProperty;"],
  [() => Map.prototype, () => { Object.defineProperty(Map.prototype, "size", d); }, "Object.defineProperty(Map.prototype, \"size\", d);"],
  [() => Map.prototype, () => { delete Map.prototype.size; }, "delete Map.prototype.size;"],
  [() => Uint8Array.prototype, () => { Uint8Array.prototype.set = f; }, "Uint8Array.prototype.set = f;"],
  [() => RegExp.prototype, () => { RegExp.prototype.exec = f; }, "RegExp.prototype.exec = f;"],
  [() => Array, () => { Array.from = f; }, "Array.from = f;"],
  [() => Array, () => { Array.isArray = f; }, "Array.isArray = f;"],
  [() => Array, () => { delete Array.from; }, "delete Array.from;"],
  [() => Array, () => { Object.defineProperty(Array, "from", d); }, "Object.defineProperty(Array, \"from\", d);"],
  [() => Math, () => { Math.max = f; }, "Math.max = f;"],
  [() => Math, () => { delete Math.max; }, "delete Math.max;"],
  [() => Math, () => { Object.defineProperty(Math, "max", d); }, "Object.defineProperty(Math, \"max\", d);"],
  [() => Math, () => { Math.max = Math.min; }, "Math.max = Math.min;"],
  [() => Math, () => { Math.max += 1; }, "Math.max += 1;"],
  [() => Math, () => { globalThis.Math.max = f; }, "globalThis.Math.max = f;"],
  [() => Reflect, () => { return Reflect.get = f; }, "Reflect.get = f;"],
  [() => Atomics, () => { Atomics.add = f; }, "Atomics.add = f;"],
  [() => Object, () => { Object.keys = f; }, "Object.keys = f;"],
  [() => Object, () => { Object.hasOwn = f; }, "Object.hasOwn = f;"],
  [() => Number, () => { Number.isNaN = f; }, "Number.isNaN = f;"],
  [() => Promise, () => { Promise.resolve = f; }, "Promise.resolve = f;"],
  [() => Symbol, () => { Symbol.for = f; }, "Symbol.for = f;"],
  [() => Proxy, () => { Proxy.revocable = f; }, "Proxy.revocable = f;"],
  [() => Date, () => { Date.toString = f; }, "Date.toString = f;"],
  [() => Date, () => { Object.defineProperty(Date, "toString", d); }, "Object.defineProperty(Date, \"toString\", d);"],
  [() => Date, () => { Date.call = f; }, "Date.call = f;"],
  [() => Date, () => { Date.hasOwnProperty = f; }, "Date.hasOwnProperty = f;"],
  [() => Array, () => { Array.bind = f; }, "Array.bind = f;"],
  [() => Array, () => { Array.constructor = f; }, "Array.constructor = f;"],
  [() => Math, () => { Math.toString = f; }, "Math.toString = f;"],
  [() => Math, () => { Object.defineProperty(Math, "toString", d); }, "Object.defineProperty(Math, \"toString\", d);"],
  [() => Math, () => { Math.hasOwnProperty = f; }, "Math.hasOwnProperty = f;"],
  [() => Math, () => { Math.constructor = f; }, "Math.constructor = f;"],
  [() => JSON, () => { JSON.valueOf = f; }, "JSON.valueOf = f;"],
  [() => Uint8Array, () => { Uint8Array.from = f; }, "Uint8Array.from = f;"],
  [() => Uint8Array, () => { Uint8Array.of = f; }, "Uint8Array.of = f;"],
  [() => Uint8Array, () => { Object.defineProperty(Uint8Array, "from", d); }, "Object.defineProperty(Uint8Array, \"from\", d);"],
  [() => Array.prototype, () => { Array.prototype.__proto__ = {}; }, "Array.prototype.__proto__ = {};"],
  [() => Array.prototype, () => { Array.prototype.__proto__ = null; }, "Array.prototype.__proto__ = null;"],
  [() => Array, () => { Array.__proto__ = {}; }, "Array.__proto__ = {};"],
  [() => Array.prototype, () => { Array.prototype.flat &&= f; }, "Array.prototype.flat &&= f;"],
  [() => Array.prototype, () => { if (Array.prototype.flat) Array.prototype.flat = f; }, "if (Array.prototype.flat) Array.prototype.flat = f;"],
  [() => Array.prototype, () => { { const P = Array.prototype; P.push = f; } }, "{ const P = Array.prototype; P.push = f; }"],
  [() => Array.prototype, () => { { const P = Array.prototype; delete P.push; } }, "{ const P = Array.prototype; delete P.push; }"],
  [() => Array.prototype, () => { { let h = f; Array.prototype.push = h; } }, "{ let h = f; Array.prototype.push = h; }"],
  [() => Array, () => { Object.defineProperty(Array, "name", d); }, "Object.defineProperty(Array, \"name\", d);"],
  [() => Array, () => { delete Array.name; }, "delete Array.name;"],
  [() => Array, () => { Object.defineProperty(Array, "length", d); }, "Object.defineProperty(Array, \"length\", d);"],
  [() => parseInt, () => { parseInt.call = f; }, "parseInt.call = f;"],
  [() => Date.prototype, () => { Date.prototype.getTime = f; }, "Date.prototype.getTime = f;"],
  [() => Intl.Collator, () => { Intl.Collator.apply = f; }, "Intl.Collator.apply = f;"],
  [() => globalThis, () => { return Reflect.set(globalThis, "Array", f); }, "Reflect.set(globalThis, \"Array\", f);"],
  [() => globalThis, () => { return Reflect.defineProperty(globalThis, "Array", d); }, "Reflect.defineProperty(globalThis, \"Array\", d);"],
  [() => globalThis, () => { return Reflect.deleteProperty(globalThis, "Array"); }, "Reflect.deleteProperty(globalThis, \"Array\");"],
  [() => globalThis, () => { globalThis.globalThis = f; }, "globalThis.globalThis = f;"],
  [() => Array.prototype, () => { Array.prototype[0] = f; }, "Array.prototype[0] = f;"],
  [() => Array.prototype, () => { return Reflect.set(Array.prototype, "push", f); }, "Reflect.set(Array.prototype, \"push\", f);"],
  [() => Array.prototype, () => { return Reflect.deleteProperty(Array.prototype, "push"); }, "Reflect.deleteProperty(Array.prototype, \"push\");"],
  [() => Array.prototype, () => { Object.assign(Array.prototype, { push: f }); }, "Object.assign(Array.prototype, { push: f });"],
  [() => Array, () => { return Reflect.set(Array, "from", f); }, "Reflect.set(Array, \"from\", f);"],
  [() => Array, () => { Object.assign(Array, { from: f }); }, "Object.assign(Array, { from: f });"],
  [() => Map, () => { Object.defineProperty(Map, Symbol.hasInstance, d); }, "Object.defineProperty(Map, Symbol.hasInstance, d);"],
  [() => Map, () => { return Reflect.defineProperty(Map, Symbol.hasInstance, d); }, "Reflect.defineProperty(Map, Symbol.hasInstance, d);"],
  [() => Array.prototype, () => { Object.setPrototypeOf(Array.prototype, {}); }, "Object.setPrototypeOf(Array.prototype, {});"],
  [() => Array.prototype, () => { return Reflect.setPrototypeOf(Array.prototype, {}); }, "Reflect.setPrototypeOf(Array.prototype, {});"],
  [() => Array.prototype, () => { Object.setPrototypeOf(Array.prototype, Map.prototype); }, "Object.setPrototypeOf(Array.prototype, Map.prototype);"],
  [() => Array, () => { Object.setPrototypeOf(Array, {}); }, "Object.setPrototypeOf(Array, {});"],
  [() => Math, () => { Object.setPrototypeOf(Math, {}); }, "Object.setPrototypeOf(Math, {});"],
  [() => globalThis, () => { [Array] = [f]; }, "[Array] = [f];"],
  [() => Array.prototype, () => { Array.prototype.length = 3; }, "Array.prototype.length = 3;"],
  [() => Map.prototype, () => { Object.defineProperty(Map.prototype, Symbol.toStringTag, d); }, "Object.defineProperty(Map.prototype, Symbol.toStringTag, d);"],
  [() => Array, () => { Object.defineProperty(Array, Symbol.species, d); }, "Object.defineProperty(Array, Symbol.species, d);"],
  [() => Function.prototype, () => { return Reflect.set(Function.prototype, "arguments", f); }, "Reflect.set(Function.prototype, \"arguments\", f);"],
  [() => Function.prototype, () => { return Reflect.set(Function.prototype, "caller", f); }, "Reflect.set(Function.prototype, \"caller\", f);"],
  [() => Iterator.prototype, () => { return Reflect.set(Iterator.prototype, "constructor", f); }, "Reflect.set(Iterator.prototype, \"constructor\", f);"],
  [() => Iterator.prototype, () => { return Reflect.set(Iterator.prototype, Symbol.toStringTag, f); }, "Reflect.set(Iterator.prototype, Symbol.toStringTag, f);"],
  [() => parseInt, () => { Object.setPrototypeOf(parseInt, {}); }, "Object.setPrototypeOf(parseInt, {});"],
  [() => Intl.Collator, () => { Object.setPrototypeOf(Intl.Collator, {}); }, "Object.setPrototypeOf(Intl.Collator, {});"],
  [() => Date.prototype, () => { Object.defineProperty(Date.prototype, Symbol.toPrimitive, d); }, "Object.defineProperty(Date.prototype, Symbol.toPrimitive, d);"],
  [() => Date.prototype, () => { return Reflect.set(Date.prototype, "toJSON", f); }, "Reflect.set(Date.prototype, \"toJSON\", f);"],
];
const { defineProperty, getOwnPropertyDescriptor, getPrototypeOf, setPrototypeOf, is } = Object;
const { ownKeys } = Reflect;
const text = String,
  log = console.log.bind(console);
function look(o) {
  const keys = ownKeys(o),
    found = [];
  for (let i = 0; i < keys.length; i++) found[i] = [keys[i], getOwnPropertyDescriptor(o, keys[i])];
  return { found, parent: getPrototypeOf(o) };
}
function isSame(a, b) {
  return is(a.value, b.value) && a.get === b.get && a.set === b.set;
}
function at(seen, key) {
  for (let i = 0; i < seen.found.length; i++) if (seen.found[i][0] === key) return seen.found[i][1];
}
function changes(before, after) {
  let said = "";
  for (let i = 0; i < after.found.length; i++) {
    const was = at(before, after.found[i][0]);
    if (!was) said += " +" + text(after.found[i][0]);
    else if (!isSame(was, after.found[i][1])) said += " ~" + text(after.found[i][0]);
  }
  for (let i = 0; i < before.found.length; i++)
    if (!at(after, before.found[i][0])) said += " -" + text(before.found[i][0]);
  return before.parent === after.parent ? said : said + " prototype";
}
function restore(o, before) {
  const after = look(o);
  try {
    if (after.parent !== before.parent) setPrototypeOf(o, before.parent);
  } catch {}
  for (let i = 0; i < after.found.length; i++)
    if (!at(before, after.found[i][0])) {
      try {
        delete o[after.found[i][0]];
      } catch {}
    }
  for (let i = 0; i < before.found.length; i++) {
    try {
      defineProperty(o, before.found[i][0], before.found[i][1]);
    } catch {}
  }
}
for (let i = 0; i < cases.length; i++) {
  const o = cases[i][0](),
    before = look(o);
  let said;
  try {
    said = cases[i][1]() === false ? "false" : "ran";
  } catch (e) {
    said = "throws " + (e && e.name);
  }
  said += changes(before, look(o));
  restore(o, before);
  log(cases[i][2] + ": " + said);
}
module.exports = {};

/* Output:
Array = f;: throws TypeError
globalThis.Array = f;: throws TypeError
delete globalThis.Array;: throws TypeError
Object.defineProperty(globalThis, "Array", d);: throws TypeError
Proxy = f;: throws TypeError
globalThis.Proxy = f;: throws TypeError
delete globalThis.Proxy;: throws TypeError
Atomics = f;: throws TypeError
Uint8Array = f;: throws TypeError
globalThis.process = f;: throws TypeError
delete globalThis.process;: throws TypeError
Array.prototype[Symbol.toPrimitive] = f;: throws TypeError
Array.prototype[Symbol.toStringTag] = "T";: throws TypeError
Object.prototype[Symbol.toPrimitive] = f;: throws TypeError
Map.prototype[Symbol.hasInstance] = f;: throws TypeError
Function.prototype.prototype = f;: throws TypeError
Object.prototype.zzz = f;: throws TypeError
Object.defineProperty(Object.prototype, "zzz", d);: throws TypeError
Function.prototype.zzz = f;: throws TypeError
Promise.prototype.zzz = f;: throws TypeError
Array.prototype.push = f;: throws TypeError
delete Array.prototype.push;: throws TypeError
Object.defineProperty(Array.prototype, "push", d);: throws TypeError
Array.prototype[Symbol.iterator] = f;: throws TypeError
delete Array.prototype[Symbol.iterator];: throws TypeError
Array.prototype.constructor = f;: throws TypeError
Array.prototype.toString = f;: throws TypeError
Array.prototype.hasOwnProperty = f;: throws TypeError
Object.defineProperty(Array.prototype, "hasOwnProperty", d);: throws TypeError
Object.prototype.toString = f;: throws TypeError
delete Object.prototype.hasOwnProperty;: throws TypeError
Object.defineProperty(Map.prototype, "size", d);: throws TypeError
delete Map.prototype.size;: throws TypeError
Uint8Array.prototype.set = f;: throws TypeError
RegExp.prototype.exec = f;: throws TypeError
Array.from = f;: throws TypeError
Array.isArray = f;: throws TypeError
delete Array.from;: throws TypeError
Object.defineProperty(Array, "from", d);: throws TypeError
Math.max = f;: throws TypeError
delete Math.max;: throws TypeError
Object.defineProperty(Math, "max", d);: throws TypeError
Math.max = Math.min;: throws TypeError
Math.max += 1;: throws TypeError
globalThis.Math.max = f;: throws TypeError
Reflect.get = f;: throws TypeError
Atomics.add = f;: throws TypeError
Object.keys = f;: throws TypeError
Object.hasOwn = f;: throws TypeError
Number.isNaN = f;: throws TypeError
Promise.resolve = f;: throws TypeError
Symbol.for = f;: throws TypeError
Proxy.revocable = f;: throws TypeError
Date.toString = f;: throws TypeError
Object.defineProperty(Date, "toString", d);: throws TypeError
Date.call = f;: throws TypeError
Date.hasOwnProperty = f;: throws TypeError
Array.bind = f;: throws TypeError
Array.constructor = f;: throws TypeError
Math.toString = f;: throws TypeError
Object.defineProperty(Math, "toString", d);: throws TypeError
Math.hasOwnProperty = f;: throws TypeError
Math.constructor = f;: throws TypeError
JSON.valueOf = f;: throws TypeError
Uint8Array.from = f;: throws TypeError
Uint8Array.of = f;: throws TypeError
Object.defineProperty(Uint8Array, "from", d);: throws TypeError
Array.prototype.__proto__ = {};: throws TypeError
Array.prototype.__proto__ = null;: throws TypeError
Array.__proto__ = {};: throws TypeError
Array.prototype.flat &&= f;: throws TypeError
if (Array.prototype.flat) Array.prototype.flat = f;: throws TypeError
{ const P = Array.prototype; P.push = f; }: throws TypeError
{ const P = Array.prototype; delete P.push; }: throws TypeError
{ let h = f; Array.prototype.push = h; }: throws TypeError
Object.defineProperty(Array, "name", d);: throws TypeError
delete Array.name;: throws TypeError
Object.defineProperty(Array, "length", d);: throws TypeError
parseInt.call = f;: throws TypeError
Date.prototype.getTime = f;: throws TypeError
Intl.Collator.apply = f;: throws TypeError
Reflect.set(globalThis, "Array", f);: false
Reflect.defineProperty(globalThis, "Array", d);: false
Reflect.deleteProperty(globalThis, "Array");: false
globalThis.globalThis = f;: throws TypeError
Array.prototype[0] = f;: throws TypeError
Reflect.set(Array.prototype, "push", f);: false
Reflect.deleteProperty(Array.prototype, "push");: false
Object.assign(Array.prototype, { push: f });: throws TypeError
Reflect.set(Array, "from", f);: false
Object.assign(Array, { from: f });: throws TypeError
Object.defineProperty(Map, Symbol.hasInstance, d);: throws TypeError
Reflect.defineProperty(Map, Symbol.hasInstance, d);: false
Object.setPrototypeOf(Array.prototype, {});: throws TypeError
Reflect.setPrototypeOf(Array.prototype, {});: false
Object.setPrototypeOf(Array.prototype, Map.prototype);: throws TypeError
Object.setPrototypeOf(Array, {});: throws TypeError
Object.setPrototypeOf(Math, {});: throws TypeError
[Array] = [f];: throws TypeError
Array.prototype.length = 3;: throws TypeError
Object.defineProperty(Map.prototype, Symbol.toStringTag, d);: throws TypeError
Object.defineProperty(Array, Symbol.species, d);: throws TypeError
Reflect.set(Function.prototype, "arguments", f);: false
Reflect.set(Function.prototype, "caller", f);: false
Reflect.set(Iterator.prototype, "constructor", f);: false
Reflect.set(Iterator.prototype, Symbol.toStringTag, f);: false
Object.setPrototypeOf(parseInt, {});: throws TypeError
Object.setPrototypeOf(Intl.Collator, {});: throws TypeError
Object.defineProperty(Date.prototype, Symbol.toPrimitive, d);: throws TypeError
Reflect.set(Date.prototype, "toJSON", f);: false
*/
