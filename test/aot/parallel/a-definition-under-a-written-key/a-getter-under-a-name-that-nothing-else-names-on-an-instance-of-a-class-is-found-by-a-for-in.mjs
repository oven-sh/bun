class A { a = 1; b = 2; }
const o = new A;
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(o, "hiddenName", { get() { this.b = "text"; return 7; }, enumerable: true }); }
act();
console.log(typeof o.a, typeof o.b);
console.log((() => { let last; for (const k in o) last = o[k]; return last; })());
console.log(typeof o.a, typeof o.b);
