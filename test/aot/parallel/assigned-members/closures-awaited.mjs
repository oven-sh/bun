// STATISTIC: AssignedMemberChecks >= 3
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const wrap = f => function (n) { return (typeof f === "function" ? f.call(this, n) : 100) + 1; };
const wrapTimes = (f, q) => function (n) { return f.call(this, n) * q + this.k; };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class A { k = 2; m(n) { return n + this.k; } q(n) { return n - this.k; } } let a = new A(); { A.prototype.m = wrapTimes(A.prototype.m ?? (() => 1), 2); A.prototype.q = wrapTimes(A.prototype.q ?? (() => 1), 3); } async function change(j) { if (j === 60) { try { A.prototype.m = wrapTimes(A.prototype.m, 5); } catch (e) { console.log("threw", e.name); } } } async function r() { let s = 0; for (let j = 0; j < 130; j++) { s += a.m(j & 3); if (j % 10 === 0) await change(j); s += a.m(j & 3); s += a.q(j & 1); } return s; } try { console.log("first", await r()); console.log("second", await r()); } catch (e) { console.log(e?.name, String(e?.message).slice(0, 60)); }
export {};
