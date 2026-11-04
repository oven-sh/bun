function F() { this.a = 1; this.b = 2; }
function act() { Object.defineProperty(F.prototype, "x", { set(v) { this.a = v; } }); }
const o = new F;
function use() { try { return (o.x = "text"); } catch (e) { return e.constructor.name; } }
console.log(typeof o.a, use(), typeof o.a);
act();
console.log(typeof o.a, use(), typeof o.a, typeof o.b);
