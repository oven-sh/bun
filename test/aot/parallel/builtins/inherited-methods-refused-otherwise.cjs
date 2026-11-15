// Beside a definition of the value that a built-in function inherits, everything that could change what the name means is refused as ever.
const log = console.log;
const attempt = (what, run) => {
  try { log(what, run()); } catch (error) { log(what, error.name, error.message.split(" (")[0]); }
};
const same = f => f.call === Function.prototype.call && f.apply === Function.prototype.apply && f.bind === Function.prototype.bind;
const other = function () { return 1; };
// The body of a class is strict.
class Strict {
  static assign(f, value) { f.call = value; return "assigned"; }
}
const kinds = { native: Math.max, library: Array.from, constructor: WeakSet, locked: Array, module: require("path").join };
for (const name of Object.keys(kinds)) {
  const f = kinds[name];
  attempt(name + " another value", () => Object.defineProperty(f, "call", { value: other }));
  attempt(name + " another inherited value", () => Object.defineProperty(f, "call", { value: f.apply }));
  attempt(name + " a value that is not there", () => Object.defineProperty(f, "call", {}));
  attempt(name + " attributes alone", () => Object.defineProperty(f, "call", { configurable: true }));
  attempt(name + " undefined", () => Object.defineProperty(f, "call", { value: undefined }));
  attempt(name + " an accessor", () => Object.defineProperty(f, "call", { get: () => Function.prototype.call }));
  attempt(name + " an accessor without a getter", () => Object.defineProperties(f, { apply: { set() {} } }));
  attempt(name + " Reflect, another value", () => Reflect.defineProperty(f, "bind", { value: other }));
  attempt(name + " an assignment", () => { f.call = other; });
  attempt(name + " an assignment of the same", () => Strict.assign(f, Function.prototype.call));
  log(name, Object.prototype.hasOwnProperty.call(f, "call"), same(f));
}
// With every attribute, so that plain would take another value behind it.
for (const name of Object.keys(kinds)) {
  const f = kinds[name];
  attempt(name + " defined", () => Object.defineProperty(f, "call", { value: f.call, writable: true, enumerable: true, configurable: true }) === f && JSON.stringify(Object.keys(f)));
  attempt(name + " another value", () => Object.defineProperty(f, "call", { value: other }));
  attempt(name + " an accessor", () => Object.defineProperty(f, "call", { get: () => other }));
  attempt(name + " Reflect, another value", () => Reflect.defineProperty(f, "call", { value: other }));
  attempt(name + " an assignment", () => { f.call = other; });
  attempt(name + " a strict assignment", () => Strict.assign(f, other));
  attempt(name + " Reflect, an assignment", () => Reflect.set(f, "call", other));
  attempt(name + " a deletion", () => delete f.call);
  attempt(name + " another inherited value", () => Object.defineProperty(f, "call", { value: f.apply, configurable: false }));
  log(name, same(f));
  attempt(name + " Object.setPrototypeOf", () => Object.setPrototypeOf(f, {}) === f);
}
// What is no function, and what stands above functions.
attempt("a prototype", () => Object.defineProperty(Function.prototype, "hasOwnProperty", { value: Function.prototype.hasOwnProperty }) === Function.prototype);
attempt("a prototype of arrays", () => Object.defineProperty(Array.prototype, "hasOwnProperty", { value: Array.prototype.hasOwnProperty }) === Array.prototype);
attempt("Object.prototype", () => Object.defineProperty(Object.prototype, "call", { value: undefined }) === Object.prototype);
// A class that stands below it was there first.
class List extends Set {}
attempt("a constructor below which a class stands", () => Object.defineProperty(Set, "call", { value: Set.call }) === Set);
List.call = other;
log(List.call === other, same(Set));
/* Output:
native another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native a value that is not there TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native attributes alone TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native undefined TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native an accessor without a getter TypeError Cannot assign to 'apply' of a built-in function because built-in objects are read-only in a compiled executable
native Reflect, another value false
native an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native an assignment of the same TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native false true
library another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library a value that is not there TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library attributes alone TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library undefined TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library an accessor without a getter TypeError Cannot assign to 'apply' of a built-in function because built-in objects are read-only in a compiled executable
library Reflect, another value false
library an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library an assignment of the same TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library false true
constructor another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor a value that is not there TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor attributes alone TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor undefined TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor an accessor without a getter TypeError Cannot assign to 'apply' of a built-in function because built-in objects are read-only in a compiled executable
constructor Reflect, another value false
constructor an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor an assignment of the same TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
constructor false true
locked another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked a value that is not there TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked attributes alone TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked undefined TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked an accessor without a getter TypeError Cannot assign to 'apply' of a built-in function because built-in objects are read-only in a compiled executable
locked Reflect, another value false
locked an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked an assignment of the same TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
locked false true
module another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module a value that is not there TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module attributes alone TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module undefined TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module an accessor without a getter TypeError Cannot assign to 'apply' of a built-in function because built-in objects are read-only in a compiled executable
module Reflect, another value false
module an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module an assignment of the same TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module false true
native defined ["call"]
native another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native Reflect, another value false
native an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native a strict assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native Reflect, an assignment false
native a deletion TypeError Cannot delete 'call' of a built-in function because built-in objects are read-only in a compiled executable
native another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
native true
native Object.setPrototypeOf TypeError Cannot change the prototype of a built-in function because built-in objects are read-only in a compiled executable
library defined ["call"]
library another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library Reflect, another value false
library an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library a strict assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library Reflect, an assignment false
library a deletion TypeError Cannot delete 'call' of a built-in function because built-in objects are read-only in a compiled executable
library another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
library true
library Object.setPrototypeOf TypeError Cannot change the prototype of a built-in function because built-in objects are read-only in a compiled executable
constructor defined ["call"]
constructor another value TypeError Cannot assign to WeakSet.call because built-in objects are read-only in a compiled executable
constructor an accessor TypeError Cannot assign to WeakSet.call because built-in objects are read-only in a compiled executable
constructor Reflect, another value false
constructor an assignment TypeError Cannot assign to WeakSet.call because built-in objects are read-only in a compiled executable
constructor a strict assignment TypeError Cannot assign to WeakSet.call because built-in objects are read-only in a compiled executable
constructor Reflect, an assignment false
constructor a deletion TypeError Cannot delete WeakSet.call because built-in objects are read-only in a compiled executable
constructor another inherited value TypeError Cannot assign to WeakSet.call because built-in objects are read-only in a compiled executable
constructor true
constructor Object.setPrototypeOf TypeError Cannot change the prototype of a built-in function because built-in objects are read-only in a compiled executable
locked defined ["call"]
locked another value TypeError Cannot assign to Array.call because built-in objects are read-only in a compiled executable
locked an accessor TypeError Cannot assign to Array.call because built-in objects are read-only in a compiled executable
locked Reflect, another value false
locked an assignment TypeError Cannot assign to Array.call because built-in objects are read-only in a compiled executable
locked a strict assignment TypeError Cannot assign to Array.call because built-in objects are read-only in a compiled executable
locked Reflect, an assignment false
locked a deletion TypeError Cannot delete Array.call because built-in objects are read-only in a compiled executable
locked another inherited value TypeError Cannot assign to Array.call because built-in objects are read-only in a compiled executable
locked true
locked Object.setPrototypeOf TypeError Cannot change the prototype of a built-in function because built-in objects are read-only in a compiled executable
module defined ["call"]
module another value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module an accessor TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module Reflect, another value false
module an assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module a strict assignment TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module Reflect, an assignment false
module a deletion TypeError Cannot delete 'call' of a built-in function because built-in objects are read-only in a compiled executable
module another inherited value TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
module true
module Object.setPrototypeOf TypeError Cannot change the prototype of a built-in function because built-in objects are read-only in a compiled executable
a prototype TypeError Cannot assign to Function.prototype.hasOwnProperty because built-in objects are read-only in a compiled executable
a prototype of arrays TypeError Cannot assign to Array.prototype.hasOwnProperty because built-in objects are read-only in a compiled executable
Object.prototype TypeError Cannot assign to Object.prototype.call because built-in objects are read-only in a compiled executable
a constructor below which a class stands TypeError Cannot assign to 'call' of a built-in function because built-in objects are read-only in a compiled executable
true true
*/
