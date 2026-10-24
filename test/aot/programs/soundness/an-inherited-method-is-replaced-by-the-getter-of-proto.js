// The getter of `__proto__`, out of its descriptor, is called on what Object.create has made: a method stored on what comes back replaces the one that the object inherits.
const base = { m() { return 1; } };
const o = Object.create(base);
o.m();
const p = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call(o);
p.m = () => "patched";
console.log(String(o.m()), String(base.m()));
