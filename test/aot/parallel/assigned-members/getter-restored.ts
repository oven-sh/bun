// @ts-nocheck
// STATISTIC: AssignedMemberChecks >= 4
const show = (label: string, f: () => unknown) => { let r; try { r = f(); } catch (e: any) { r = `${e?.name}: ${e?.message}`.slice(0, 90); } console.log(label, typeof r === "object" ? Object.prototype.toString.call(r) : String(r).slice(0, 60)); };
const hidden = (x: any): any => JSON.parse("[0]", (key, value) => key === "0" ? x : value[0]);
let calls = 0; function d(f: any, c: any) { return function (this: any, n: any) { calls++; return f.call(this, n) + (calls & 1); }; } class A { k: any = 2; @d get v() { return this.k; } @d m(n: any) { return n + this.k; } } let a: any = new A(); function change(j: any): any { if (j === 60) { try { const t = Object.getOwnPropertyDescriptor(A.prototype, "v")!; delete (A.prototype as any).v; Object.defineProperty(A.prototype, "v", t); } catch (e: any) { console.log("threw", e.name); } } return j > 1e9 ? change(j - 1) + 1 : 0; } function r() { let s: any = 0; for (let j = 0; j < 150; j++) { s += a.v; s += change(j); s += a.v; if (typeof s === "string" && s.length > 100) s = 0; } return s; } show("called", r); show("again", r);
export {};
