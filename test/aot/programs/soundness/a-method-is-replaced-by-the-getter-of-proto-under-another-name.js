// The getter of `__proto__` becomes the getter of a property of the program's own class: a read of that property climbs, and a method stored on what comes back replaces the method of the class.
class A { m() { return 1; } }
new A().m();
Object.defineProperty(A.prototype, "up", { get: Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get });
new A().up.m = () => "patched";
console.log(String(new A().m()));
