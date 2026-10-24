// The getter of `__proto__` is taken out of all the descriptors of Object.prototype and called on an instance: a method stored on what comes back replaces the method of the class.
class A { m() { return 1; } }
new A().m();
const p = Object.getOwnPropertyDescriptors(Object.prototype).__proto__.get.call(new A());
p.m = () => "patched";
console.log(String(new A().m()));
