// STATISTIC: AssignedMemberChecks >= 4
// parent captures, own
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
class P { k = 0; m(n) { return n * 2000 + this.k; } } class A extends P { z = 1; } let a = new A(); (q => { P.prototype.m = function (n) { return n * q + this.k; }; })(5); function g(j) { if (j === 70) { Object.defineProperty(a, "m", { value: function (n) { return n - 1; }, configurable: true, writable: true }); } return j > 1e9 ? g(j - 1) + 1 : 0; } function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.m(j & 3); s += g(j); s += a.m(j & 3); } return s; } show("called", r); show("again", r);
