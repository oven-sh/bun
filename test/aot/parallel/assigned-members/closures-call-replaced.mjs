// STATISTIC: AssignedMemberChecks >= 2
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const wrap = f => function (n) { return (typeof f === "function" ? f.call(this, n) : 100) + 1; };
const wrapTimes = (f, q) => function (n) { return f.call(this, n) * q + this.k; };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class A { k = 2; m(n) { return n + this.k; } q(n) { return n - this.k; } } let a = new A(); function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.m(j & 3); s += a.q(j & 7); } return s; } show("before", r); { A.prototype.m = wrapTimes(A.prototype.m ?? (() => 1), 2); A.prototype.q = wrapTimes(A.prototype.q ?? (() => 1), 3); } show("after", r); try { const g = function (n) { return n + 1; }; g.call = () => 500; A.prototype.m = wrap(g); } catch (e) { console.log("threw", e.name); } show("then", r); show("again", r); a = new A(); show("new", r);
export {};
