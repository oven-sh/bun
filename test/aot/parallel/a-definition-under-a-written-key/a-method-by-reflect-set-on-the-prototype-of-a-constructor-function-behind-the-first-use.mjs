function F() { this.a = 1; this.b = 2; }
function act() { Reflect.set(F.prototype, "x", function () { this.a = "text"; return 7; }); }
const o = new F;
function use() { try { return o.x(); } catch (e) { return e.constructor.name; } }
console.log(typeof o.a, use(), typeof o.a);
act();
console.log(typeof o.a, use(), typeof o.a, typeof o.b);
