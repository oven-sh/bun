const o = { a: 1, b: 2 };
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(o, "hiddenName", { set(v) { this.b = v; } }); }
act();
o["hidden" + suffix] = "text";
console.log(typeof o.a, typeof o.b);
