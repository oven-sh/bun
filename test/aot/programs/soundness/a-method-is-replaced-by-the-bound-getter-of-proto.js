// The getter of `__proto__` is bound to an instance and called: a method stored on what comes back replaces the method of the class.
class A { m() { return 1; } }
new A().m();
const p = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.bind(new A())();
p.m = () => "patched";
console.log(String(new A().m()));
