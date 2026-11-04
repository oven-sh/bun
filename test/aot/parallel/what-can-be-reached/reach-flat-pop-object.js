// What comes out of flat pop is used as what it is (object, erased).
class P { x = 1; y = 2; m() { return this.x + 1; } toString() { return "P" + this.x; } }
class Q extends P { x = 5; }
function flatten(l) { return l.flat(); }
function pushed(x) { const outer = []; for (let i = 0; i < 2; i++) { const inner = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l) { const seen = []; JSON.stringify(l, function (k, val) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x) => typeof x === "string" ? JSON.stringify(x) : String(x);
function straight0() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e.x; }
function used0(e, v) { return e.x; }
function passed0() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used0(r.pop(), v); }
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e.x) + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0());
function straight1() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e.m(); }
function used1(e, v) { return e.m(); }
function passed1() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used1(r.pop(), v); }
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e.m()) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1());
function straight2() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e.y + 1; }
function used2(e, v) { return e.y + 1; }
function passed2() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used2(r.pop(), v); }
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e.y + 1) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2());
function straight3() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e === v; }
function used3(e, v) { return e === v; }
function passed3() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used3(r.pop(), v); }
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e === v) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3());
function straight4() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return typeof e; }
function used4(e, v) { return typeof e; }
function passed4() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used4(r.pop(), v); }
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(typeof e) + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4());
function straight5() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e instanceof P; }
function used5(e, v) { return e instanceof P; }
function passed5() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used5(r.pop(), v); }
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e instanceof P) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5());
function straight6() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e instanceof Array; }
function used6(e, v) { return e instanceof Array; }
function passed6() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used6(r.pop(), v); }
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e instanceof Array) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6());
function straight7() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return Array.isArray(e); }
function used7(e, v) { return Array.isArray(e); }
function passed7() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used7(r.pop(), v); }
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(Array.isArray(e)) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7());
function straight8() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return String(e.length); }
function used8(e, v) { return String(e.length); }
function passed8() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used8(r.pop(), v); }
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(String(e.length)) + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8());
function straight9() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return "" + e; }
function used9(e, v) { return "" + e; }
function passed9() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used9(r.pop(), v); }
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show("" + e) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9());
function straight10() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return `${e}`; }
function used10(e, v) { return `${e}`; }
function passed10() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used10(r.pop(), v); }
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(`${e}`) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
function straight11() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e == null; }
function used11(e, v) { return e == null; }
function passed11() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used11(r.pop(), v); }
function looped11() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e == null) + ","; } return all; }
console.log(11, show(straight11()), show(passed11()), looped11());
function straight12() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return !e; }
function used12(e, v) { return !e; }
function passed12() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used12(r.pop(), v); }
function looped12() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(!e) + ","; } return all; }
console.log(12, show(straight12()), show(passed12()), looped12());
function straight13() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return Object.keys(e).join(); }
function used13(e, v) { return Object.keys(e).join(); }
function passed13() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used13(r.pop(), v); }
function looped13() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(Object.keys(e).join()) + ","; } return all; }
console.log(13, show(straight13()), show(passed13()), looped13());
function straight14() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return (e.x = "s", v.x); }
function used14(e, v) { return (e.x = "s", v.x); }
function passed14() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used14(r.pop(), v); }
function looped14() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show((e.x = "s", v.x)) + ","; } return all; }
console.log(14, show(straight14()), show(passed14()), looped14());
function straight15() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return (e.z = 1, Object.keys(v).join()); }
function used15(e, v) { return (e.z = 1, Object.keys(v).join()); }
function passed15() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used15(r.pop(), v); }
function looped15() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show((e.z = 1, Object.keys(v).join())) + ","; } return all; }
console.log(15, show(straight15()), show(passed15()), looped15());
function straight16() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return (delete e.y, Object.keys(v).join()); }
function used16(e, v) { return (delete e.y, Object.keys(v).join()); }
function passed16() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used16(r.pop(), v); }
function looped16() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show((delete e.y, Object.keys(v).join())) + ","; } return all; }
console.log(16, show(straight16()), show(passed16()), looped16());
function straight17() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return "x" in e; }
function used17(e, v) { return "x" in e; }
function passed17() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used17(r.pop(), v); }
function looped17() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show("x" in e) + ","; } return all; }
console.log(17, show(straight17()), show(passed17()), looped17());
function straight18() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return e.constructor === P; }
function used18(e, v) { return e.constructor === P; }
function passed18() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used18(r.pop(), v); }
function looped18() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(e.constructor === P) + ","; } return all; }
console.log(18, show(straight18()), show(passed18()), looped18());
function straight19() { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); return JSON.stringify(e); }
function used19(e, v) { return JSON.stringify(e); }
function passed19() { const v = new P(); const w = new Q(); const r = [[v]].flat(); return used19(r.pop(), v); }
function looped19() { let all = ""; for (let i = 0; i < 3; i++) { const v = new P(); const w = new Q(); const r = [[v]].flat(); const e = r.pop(); all += show(JSON.stringify(e)) + ","; } return all; }
console.log(19, show(straight19()), show(passed19()), looped19());
