// STATISTIC: AssignedMemberChecks >= 2
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class A { k = 2; m() { return this.k; } } A.prototype.v = [1, 2, 3]; let a = new A(); function change(j) { if (j === 60) { try { if (Array.isArray(A.prototype.v)) A.prototype.v.push(9); else A.prototype.v = [4]; } catch (e) { console.log("threw", e.name); } } return j > 1e9 ? change(j - 1) + 1 : 0; } function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.v?.[j & 1] ?? 1; s += change(j); s += a.v?.[j & 1] ?? 1; } return s; } show("called", r); show("again", r);
export {};
