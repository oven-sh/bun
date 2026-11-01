// The mode of a store or a delete is that of the innermost scope. This file is sloppy. A store to a fixed member of a built-in prototype throws there too, and a store to a frozen object of the program's own is ignored. Class code is strict wherever it stands: a method, a static block, the `extends` clause and a computed key throw a TypeError. A frozen object of the program answers the same way, in plain Bun too.
const frozen = Object.freeze({ held: 1 });
function attempt(label, f) { try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", e.name); } }
function cases(name, target, member) {
  attempt(name + ", a function of this file, store", () => { target[member] = 2; return "no error"; });
  attempt(name + ", a function of this file, delete", () => delete target[member]);
  attempt(name + ", a method, store", () => new (class { run() { target[member] = 2; return "no error"; } })().run());
  attempt(name + ", a method, delete", () => new (class { run() { return delete target[member]; } })().run());
  attempt(name + ", a static block", () => { class Block { static { target[member] = 2; } } return "no error"; });
  attempt(name + ", the extends clause", () => { class Derived extends (target[member] = 2, Object) {} return "no error"; });
  attempt(name + ", a computed key", () => { class Keyed { [(target[member] = 2, "key")]() {} } return "no error"; });
  attempt(name + ", a function inside a method", () => new (class { run() { return (function () { target[member] = 2; return "no error"; })(); } })().run());
}
cases("Array.prototype", Array.prototype, "push");
cases("a frozen object", frozen, "held");
console.log(typeof Array.prototype.push, frozen.held);
module.exports = {};
/* Output:
Array.prototype, a function of this file, store: TypeError
Array.prototype, a function of this file, delete: TypeError
Array.prototype, a method, store: TypeError
Array.prototype, a method, delete: TypeError
Array.prototype, a static block: TypeError
Array.prototype, the extends clause: TypeError
Array.prototype, a computed key: TypeError
Array.prototype, a function inside a method: TypeError
a frozen object, a function of this file, store: no error
a frozen object, a function of this file, delete: false
a frozen object, a method, store: TypeError
a frozen object, a method, delete: TypeError
a frozen object, a static block: TypeError
a frozen object, the extends clause: TypeError
a frozen object, a computed key: TypeError
a frozen object, a function inside a method: TypeError
function 1
*/
