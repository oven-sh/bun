function F() { this.a = 1; this.b = 2; }
function act() { Object.defineProperty(F.prototype, "x", { set(v) { this.a = v; } }); }
act();
const o = new F;
console.log(typeof o.a, typeof o.b, (o.x = "text"), typeof o.a, typeof o.b);
