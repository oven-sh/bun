// The getter of `__proto__` is taken by __lookupGetter__ and called on an instance: what comes back is the prototype object of the class, and a method stored on it replaces the method for every instance. Nothing else in the program names a way to a prototype.
class C { m() { return 1; } }
new C().m();
const c = Object.prototype.__lookupGetter__("__proto__").call(new C());
c.m = () => "patched";
console.log(String(new C().m()));
