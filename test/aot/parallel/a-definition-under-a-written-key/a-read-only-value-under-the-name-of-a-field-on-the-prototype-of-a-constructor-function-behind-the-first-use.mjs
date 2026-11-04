function F() { this.a = 1; this.b = 2; }
function act() { Object.defineProperty(F.prototype, "late", { value: 1, writable: false }); }
const o = new F;
function use() { try { return (() => { try { o.late = "text"; } catch (e) { return e.constructor.name; } return typeof o.late; })(); } catch (e) { return e.constructor.name; } }
console.log(typeof o.a, use(), typeof o.a);
act();
console.log(typeof o.a, use(), typeof o.a, typeof o.b);
