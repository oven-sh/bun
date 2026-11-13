// STATISTIC: AssignedMemberChecks >= 1
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class P { k = 2; } class A extends P { z = 1; } Object.defineProperties(P.prototype, { v: { value: 6, configurable: true }, w: { get() { return this.k; } } }); let a = new A(); function r() { let s = 0; for (let j = 0; j < 150; j++) { if (j === 75) a.v = 2; s += +a.v; } return s; } show("after", r); Bun.gc(true); show("collected", r); try { a.v = 40; } catch (e) { console.log("threw", e.name); } show("then", r); a = new A(3); show("new", r);
export {};
