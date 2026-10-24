// The getter of `__proto__`, out of its descriptor, is called on a class: what comes back is the class that it extends, and a static method stored there replaces the inherited one.
class A { static s() { return 1; } }
class B extends A {}
B.s();
const p = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call(B);
p.s = () => "patched";
console.log(String(B.s()), p === A);
