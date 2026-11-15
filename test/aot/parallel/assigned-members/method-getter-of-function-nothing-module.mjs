// method getter of function, nothing
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
class A { k = 3; m(n) { return n * 1000 + this.k; } } let a = new A(); function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.m(j & 3); } return s; }
show("before", r); show("put", () => { Object.defineProperty(A.prototype, "m", { get() { return function (n) { return n * 9 + this.k; }; }, configurable: true }); }); show("after", r); show("change", () => {  }); show("then", r); show("again", r); a = new A(); show("new", r);
