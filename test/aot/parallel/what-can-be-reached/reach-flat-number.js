// What comes out of flat is used as what it is (number, erased).
function flatten(l) { return l.flat(); }
function pushed(x) { const outer = []; for (let i = 0; i < 2; i++) { const inner = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l) { const seen = []; JSON.stringify(l, function (k, val) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x) => typeof x === "string" ? JSON.stringify(x) : String(x);
function straight0() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e + 1; }
function used0(e, v) { return e + 1; }
function passed0() { const v = 41; const w = 7; const r = [[v]].flat(); return used0(r[0], v); }
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e + 1) + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0());
function straight1() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e * 2; }
function used1(e, v) { return e * 2; }
function passed1() { const v = 41; const w = 7; const r = [[v]].flat(); return used1(r[0], v); }
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e * 2) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1());
function straight2() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e | 0; }
function used2(e, v) { return e | 0; }
function passed2() { const v = 41; const w = 7; const r = [[v]].flat(); return used2(r[0], v); }
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e | 0) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2());
function straight3() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e < 50; }
function used3(e, v) { return e < 50; }
function passed3() { const v = 41; const w = 7; const r = [[v]].flat(); return used3(r[0], v); }
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e < 50) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3());
function straight4() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e === 41; }
function used4(e, v) { return e === 41; }
function passed4() { const v = 41; const w = 7; const r = [[v]].flat(); return used4(r[0], v); }
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e === 41) + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4());
function straight5() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return typeof e; }
function used5(e, v) { return typeof e; }
function passed5() { const v = 41; const w = 7; const r = [[v]].flat(); return used5(r[0], v); }
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(typeof e) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5());
function straight6() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return Array.isArray(e); }
function used6(e, v) { return Array.isArray(e); }
function passed6() { const v = 41; const w = 7; const r = [[v]].flat(); return used6(r[0], v); }
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(Array.isArray(e)) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6());
function straight7() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return String(e.length); }
function used7(e, v) { return String(e.length); }
function passed7() { const v = 41; const w = 7; const r = [[v]].flat(); return used7(r[0], v); }
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(String(e.length)) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7());
function straight8() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return String(e); }
function used8(e, v) { return String(e); }
function passed8() { const v = 41; const w = 7; const r = [[v]].flat(); return used8(r[0], v); }
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(String(e)) + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8());
function straight9() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e.toFixed(1); }
function used9(e, v) { return e.toFixed(1); }
function passed9() { const v = 41; const w = 7; const r = [[v]].flat(); return used9(r[0], v); }
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e.toFixed(1)) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9());
function straight10() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return Math.abs(e); }
function used10(e, v) { return Math.abs(e); }
function passed10() { const v = 41; const w = 7; const r = [[v]].flat(); return used10(r[0], v); }
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(Math.abs(e)) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
function straight11() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return -e; }
function used11(e, v) { return -e; }
function passed11() { const v = 41; const w = 7; const r = [[v]].flat(); return used11(r[0], v); }
function looped11() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(-e) + ","; } return all; }
console.log(11, show(straight11()), show(passed11()), looped11());
function straight12() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e % 5; }
function used12(e, v) { return e % 5; }
function passed12() { const v = 41; const w = 7; const r = [[v]].flat(); return used12(r[0], v); }
function looped12() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e % 5) + ","; } return all; }
console.log(12, show(straight12()), show(passed12()), looped12());
function straight13() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return "" + e; }
function used13(e, v) { return "" + e; }
function passed13() { const v = 41; const w = 7; const r = [[v]].flat(); return used13(r[0], v); }
function looped13() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show("" + e) + ","; } return all; }
console.log(13, show(straight13()), show(passed13()), looped13());
function straight14() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return !e; }
function used14(e, v) { return !e; }
function passed14() { const v = 41; const w = 7; const r = [[v]].flat(); return used14(r[0], v); }
function looped14() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(!e) + ","; } return all; }
console.log(14, show(straight14()), show(passed14()), looped14());
function straight15() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e == null; }
function used15(e, v) { return e == null; }
function passed15() { const v = 41; const w = 7; const r = [[v]].flat(); return used15(r[0], v); }
function looped15() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e == null) + ","; } return all; }
console.log(15, show(straight15()), show(passed15()), looped15());
function straight16() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return [10, 20][e - 41]; }
function used16(e, v) { return [10, 20][e - 41]; }
function passed16() { const v = 41; const w = 7; const r = [[v]].flat(); return used16(r[0], v); }
function looped16() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show([10, 20][e - 41]) + ","; } return all; }
console.log(16, show(straight16()), show(passed16()), looped16());
function straight17() { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; return e > 40 ? "big" : "small"; }
function used17(e, v) { return e > 40 ? "big" : "small"; }
function passed17() { const v = 41; const w = 7; const r = [[v]].flat(); return used17(r[0], v); }
function looped17() { let all = ""; for (let i = 0; i < 3; i++) { const v = 41; const w = 7; const r = [[v]].flat(); const e = r[0]; all += show(e > 40 ? "big" : "small") + ","; } return all; }
console.log(17, show(straight17()), show(passed17()), looped17());
