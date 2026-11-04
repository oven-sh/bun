// `Object.create(proto, { constructor: { value: B, .. } })`: the map's own names answer, whatever Object.prototype holds under them.
"use strict";
function A() { this.z = 1; }
function B() { this.z = 2; }
function named() { return "named " + (this === undefined ? "undefined" : typeof this); }
const log = [];

const made = Object.create(A.prototype, {
  constructor: { value: B, writable: true, configurable: true },
  toString: { value: named },
  valueOf: { get() { log.push("valueOf read"); return named; } },
  hasOwnProperty: { value: named, enumerable: true },
  isPrototypeOf: { set(v) { log.push("isPrototypeOf stored " + v); } },
});
console.log(made.constructor === B, new made.constructor().z, made.toString(), made.valueOf(), made.hasOwnProperty("x"), made.isPrototypeOf, Object.keys(made).join());
made.isPrototypeOf = 5;
made.constructor = A;
console.log(made.constructor === A, log.join("; "));
try { made.toString = 1; } catch (e) { console.log(e.constructor.name); }

const defined = Object.defineProperties({}, {
  constructor: { value: B },
  propertyIsEnumerable: { value: named },
  toLocaleString: { get: named },
});
console.log(defined.constructor === B, defined.propertyIsEnumerable(), defined.toLocaleString, Object.getOwnPropertyNames(defined).join());

// A name that is computed may be one of those that are written.
function withComputed(name) {
  return Object.create(null, { constructor: { value: A, configurable: true }, [name]: { value: B, configurable: true } });
}
console.log(withComputed("constructor").constructor === B, withComputed("other").constructor === A, withComputed("other").other === B);

// `__proto__` written in a literal is no name of the map: it says what stands above it, and what stands there is not listed.
const above = { inherited: { value: "not taken" } };
const below = Object.create(null, { __proto__: above, own: { value: "taken" } });
console.log(below.own, below.inherited, Object.getOwnPropertyNames(below).join());
const spelled = Object.create(null, { ["__proto__"]: { value: "a property", enumerable: true } });
console.log(Object.keys(spelled).join(), spelled.__proto__);

// In a loop, with what the map names called and constructed.
function make(i) {
  return Object.create(A.prototype, { constructor: { value: i & 1 ? A : B, writable: true, configurable: true }, valueOf: { value() { return i; } } });
}
let sum = 0;
for (let i = 0; i < 3000; i++) { const o = make(i); sum += new o.constructor().z + o.valueOf() % 3; }
console.log(sum);
