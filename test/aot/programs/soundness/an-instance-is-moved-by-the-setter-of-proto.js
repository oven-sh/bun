// The setter of `__proto__` is taken out of its descriptor and called on an instance: the instance has another object above it from then on, finds that object's method, and is no instance of its class.
class A { m() { return 1; } }
const a = new A();
a.m();
const set = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set;
set.call(a, { m() { return "patched"; } });
console.log(String(a.m()), a instanceof A, Object.getPrototypeOf(a) === A.prototype);
