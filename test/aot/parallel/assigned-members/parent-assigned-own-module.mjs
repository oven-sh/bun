// parent assigned, own
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
class P { k = 0; m(n) { return n * 2000 + this.k; } } class A extends P { z = 1; } let a = new A(); function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.m(j & 3); } return s; }
show("before", r); show("put", () => { P.prototype.m = function (n) { return n + this.k; }; }); show("after", r); show("change", () => { Object.defineProperty(a, "m", { value: function (n) { return n - 1; }, configurable: true, writable: true }); }); show("then", r); show("again", r); a = new A(); show("new", r);
