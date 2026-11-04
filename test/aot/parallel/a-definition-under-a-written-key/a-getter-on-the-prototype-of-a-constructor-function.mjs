function F() { this.a = 1; this.b = 2; }
function act() { Object.defineProperty(F.prototype, "x", { get() { this.a = "text"; return 7; } }); }
act();
const o = new F;
console.log(typeof o.a, typeof o.b, o.x, typeof o.a, typeof o.b);
