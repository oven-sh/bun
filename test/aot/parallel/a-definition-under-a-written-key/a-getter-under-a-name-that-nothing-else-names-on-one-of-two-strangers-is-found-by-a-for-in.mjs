class A { a = 1; b = 2; }
class B { a = 1; b = 2; c = 3; }
const both = [new B, new A];
const o = both[both.length - 1];
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(o, "hiddenName", { get() { this.b = "text"; return 7; }, enumerable: true }); }
act();
console.log(typeof o.a, typeof o.b);
console.log((() => { let last; for (const k in o) last = o[k]; return last; })());
console.log(typeof o.a, typeof o.b);
