// The getter of `__proto__`, out of its descriptor, is called on what a constructor function has made: a method stored on what comes back replaces the one on the function's prototype object.
function F() {}
F.prototype.m = function () { return 1; };
new F().m();
const p = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get.call(new F());
p.m = () => "patched";
console.log(String(new F().m()));
