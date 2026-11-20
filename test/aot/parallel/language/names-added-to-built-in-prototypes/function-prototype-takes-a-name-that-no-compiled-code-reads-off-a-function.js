// A helper lays a method on Function.prototype, which it finds under a computed name, so the build sees neither the object nor that it is written. No compiled code reads the name off a function of the program, so nothing has taken it for absent: the store holds, and whoever looks finds it.
function lay(target, name, value) { return Object.defineProperty(target, name, { value, writable: true, configurable: true }); }
function layAll(owner, methods) { const target = globalThis[owner].prototype; for (const name in methods) lay(target, name, methods[name]); }
layAll("Function", { part() { return this.bind(undefined, ...arguments); } });
console.log(Math.max.part(2)(1));
const text = hex => Buffer.from(hex, "hex").toString();
const part = text("70617274"), more = text("6d6f7265");
const own = (a, b) => a + b;
async function later() {}
function* generate() {}
async function* generateLater() {}
console.log(own[part](2)(1), part in own, Object.hasOwn(Function.prototype, part), Object.isExtensible(Function.prototype));
for (const made of [later, generate, generateLater]) {
  const prototype = Object.getPrototypeOf(made);
  prototype[more] = made.name.length;
  console.log(made[more], own[more], Reflect.deleteProperty(prototype, more), made[more], Object.isExtensible(prototype));
}
console.log(delete Function.prototype[part], own[part], own(1, 2), own.name, own.length);
/* Output:
2
3 true true true
5 undefined true undefined true
8 undefined true undefined true
13 undefined true undefined true
true undefined 3 own 2
*/
