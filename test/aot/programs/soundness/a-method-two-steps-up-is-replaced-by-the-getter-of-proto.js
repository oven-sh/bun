// The getter of `__proto__`, out of its descriptor, is called twice: it climbs from an instance past its own class to the class above, and a method stored there replaces the inherited one.
class A { m() { return 1; } }
class B extends A {}
new B().m();
const get = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get;
const p = get.call(get.call(new B()));
p.m = () => "patched";
console.log(String(new B().m()), p === A.prototype);
