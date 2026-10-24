// The setter of `__proto__`, out of its descriptor, is called on a list: it is still an array, is no instance of Array, and finds the `map` of the object that now lies above it.
class A { m() { return 1; } }
const list = [new A()];
list[0].m();
const set = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set;
set.call(list, { length: 0, map() { return "patched"; } });
console.log(String(list.map(x => x)), Array.isArray(list), list instanceof Array);
