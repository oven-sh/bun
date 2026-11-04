// What comes out of flat last is used as what it is (object, inferred).
class P { x = 1; y = 2; m() { return this.x + 1; } toString() { return "P" + this.x; } }
class Q extends P { x = 5; }
type T = P;
function flatten(l: T[][]): T[] { return l.flat(); }
function pushed(x: T): T[][] { const outer: T[][] = []; for (let i = 0; i < 2; i++) { const inner: T[] = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l: T[][]): T[] { const seen: T[] = []; JSON.stringify(l, function (k: string, val: any) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x: unknown) => typeof x === "string" ? JSON.stringify(x) : String(x);
function straight0() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e.x; }
function used0(e: T, v: T) { return e.x; }
function passed0() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used0(r.at(-1), v); }
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e.x) + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0());
function straight1() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e.m(); }
function used1(e: T, v: T) { return e.m(); }
function passed1() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used1(r.at(-1), v); }
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e.m()) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1());
function straight2() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e.y + 1; }
function used2(e: T, v: T) { return e.y + 1; }
function passed2() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used2(r.at(-1), v); }
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e.y + 1) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2());
function straight3() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e === v; }
function used3(e: T, v: T) { return e === v; }
function passed3() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used3(r.at(-1), v); }
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e === v) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3());
function straight4() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return typeof e; }
function used4(e: T, v: T) { return typeof e; }
function passed4() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used4(r.at(-1), v); }
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(typeof e) + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4());
function straight5() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e instanceof P; }
function used5(e: T, v: T) { return e instanceof P; }
function passed5() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used5(r.at(-1), v); }
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e instanceof P) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5());
function straight6() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e instanceof Array; }
function used6(e: T, v: T) { return e instanceof Array; }
function passed6() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used6(r.at(-1), v); }
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e instanceof Array) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6());
function straight7() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return Array.isArray(e); }
function used7(e: T, v: T) { return Array.isArray(e); }
function passed7() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used7(r.at(-1), v); }
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(Array.isArray(e)) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7());
function straight8() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return String(e.length); }
function used8(e: T, v: T) { return String(e.length); }
function passed8() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used8(r.at(-1), v); }
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(String(e.length)) + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8());
function straight9() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return "" + e; }
function used9(e: T, v: T) { return "" + e; }
function passed9() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used9(r.at(-1), v); }
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show("" + e) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9());
function straight10() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return `${e}`; }
function used10(e: T, v: T) { return `${e}`; }
function passed10() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used10(r.at(-1), v); }
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(`${e}`) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
function straight11() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e == null; }
function used11(e: T, v: T) { return e == null; }
function passed11() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used11(r.at(-1), v); }
function looped11() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e == null) + ","; } return all; }
console.log(11, show(straight11()), show(passed11()), looped11());
function straight12() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return !e; }
function used12(e: T, v: T) { return !e; }
function passed12() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used12(r.at(-1), v); }
function looped12() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(!e) + ","; } return all; }
console.log(12, show(straight12()), show(passed12()), looped12());
function straight13() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return Object.keys(e).join(); }
function used13(e: T, v: T) { return Object.keys(e).join(); }
function passed13() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used13(r.at(-1), v); }
function looped13() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(Object.keys(e).join()) + ","; } return all; }
console.log(13, show(straight13()), show(passed13()), looped13());
function straight14() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return (e.x = "s", v.x); }
function used14(e: T, v: T) { return (e.x = "s", v.x); }
function passed14() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used14(r.at(-1), v); }
function looped14() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show((e.x = "s", v.x)) + ","; } return all; }
console.log(14, show(straight14()), show(passed14()), looped14());
function straight15() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return (e.z = 1, Object.keys(v).join()); }
function used15(e: T, v: T) { return (e.z = 1, Object.keys(v).join()); }
function passed15() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used15(r.at(-1), v); }
function looped15() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show((e.z = 1, Object.keys(v).join())) + ","; } return all; }
console.log(15, show(straight15()), show(passed15()), looped15());
function straight16() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return (delete e.y, Object.keys(v).join()); }
function used16(e: T, v: T) { return (delete e.y, Object.keys(v).join()); }
function passed16() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used16(r.at(-1), v); }
function looped16() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show((delete e.y, Object.keys(v).join())) + ","; } return all; }
console.log(16, show(straight16()), show(passed16()), looped16());
function straight17() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return "x" in e; }
function used17(e: T, v: T) { return "x" in e; }
function passed17() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used17(r.at(-1), v); }
function looped17() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show("x" in e) + ","; } return all; }
console.log(17, show(straight17()), show(passed17()), looped17());
function straight18() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return e.constructor === P; }
function used18(e: T, v: T) { return e.constructor === P; }
function passed18() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used18(r.at(-1), v); }
function looped18() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(e.constructor === P) + ","; } return all; }
console.log(18, show(straight18()), show(passed18()), looped18());
function straight19() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); return JSON.stringify(e); }
function used19(e: T, v: T) { return JSON.stringify(e); }
function passed19() { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); return used19(r.at(-1), v); }
function looped19() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = new P(); const w: T = new Q(); const r = [[w], [v]].flat(); const e: T = r.at(-1); all += show(JSON.stringify(e)) + ","; } return all; }
console.log(19, show(straight19()), show(passed19()), looped19());
