function F() { this.a = 1; this.b = 2; }
function act() { Object.defineProperty(F.prototype, "late", { value: 1, writable: false }); }
act();
const o = new F;
console.log(typeof o.a, typeof o.b, (() => { try { o.late = "text"; } catch (e) { return e.constructor.name; } return typeof o.late; })(), typeof o.a, typeof o.b);
