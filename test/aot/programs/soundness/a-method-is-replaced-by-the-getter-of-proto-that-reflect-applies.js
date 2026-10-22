// The getter of `__proto__` is applied to an instance by Reflect.apply: a method stored on what comes back replaces the method of the class.
class A { m() { return 1; } }
new A().m();
const p = Reflect.apply(Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get, new A(), []);
p.m = () => "patched";
console.log(String(new A().m()));
