class A { a = 1; }
const o = new A;
function act() { Object.defineProperty(o, "__proto__", { get() { this.a = "text"; return null; } }); }
act();
console.log(typeof o.a, o.__proto__, typeof o.a, o instanceof A);
