// The getter of `__proto__` is taken by Reflect.getOwnPropertyDescriptor and called on an instance: a method stored on what comes back replaces the method of the class.
class A { m() { return 1; } }
new A().m();
const p = Reflect.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call(new A());
p.m = () => "patched";
console.log(String(new A().m()));
