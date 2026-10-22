// The setter of `__proto__` is taken by __lookupSetter__ and called on an instance: the instance finds the method of the object that now lies above it.
class A { m() { return 1; } }
const a = new A();
a.m();
Object.prototype.__lookupSetter__("__proto__").call(a, { m() { return "patched"; } });
console.log(String(a.m()), a instanceof A);
