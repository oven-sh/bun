class A { a = 1; b = 2; }
const o = new A;
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(o, "hiddenName", { get() { this.b = "text"; return 7; }, enumerable: true }); }
act();
console.log(typeof o.a, typeof o.b);
console.log(JSON.stringify(o));
console.log(typeof o.a, typeof o.b);
