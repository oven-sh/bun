// STATISTIC: AssignedMemberChecks >= 3
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const wrap = f => function (n) { return (typeof f === "function" ? f.call(this, n) : 100) + 1; };
const wrapTimes = (f, q) => function (n) { return f.call(this, n) * q + this.k; };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class A { k = 2; m(n) { return n + this.k; } q(n) { return n - this.k; } } let a = new A(); { for (const name of ["m", "q"]) { const f = A.prototype[name]; A.prototype[name] = function (n) { return f.call(this, n) + 1; }; } } function* g() { let s = 0; for (let j = 0; j < 130; j++) { s += a.m(j & 3) + a.q(j & 1); if (j % 10 === 0) yield s; s += a.m(1); } return s; } show("yields", () => { let last = 0, j = 0; for (const x of g()) { last = last * 3 + x; j++; if (j === 6) { try { A.prototype.m = wrapTimes(A.prototype.m, 5); } catch (e) { console.log("threw", e.name); } } } return last; });
export {};
