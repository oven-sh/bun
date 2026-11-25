// STATISTIC: AssignedMemberChecks >= 1
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const hidden = x => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
class A { k = 2; m() { return this.k; } } Object.defineProperty(A.prototype, "v", { value: 8 }); let a = new A(); function r() { let s = 0; for (let j = 0; j < 150; j++) { s += a.v?.[j & 1] ?? 1; } return s; } show("after", r); Bun.gc(true); show("collected", r); try { hidden(A).prototype["v" + ""] = 45; } catch (e) { console.log("threw", e.name); } show("then", r); a = new A(3); show("new", r);
export {};
