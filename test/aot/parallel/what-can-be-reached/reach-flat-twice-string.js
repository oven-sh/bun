// What comes out of flat twice is used as what it is (string, erased).
function flatten(l) { return l.flat(); }
function pushed(x) { const outer = []; for (let i = 0; i < 2; i++) { const inner = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l) { const seen = []; JSON.stringify(l, function (k, val) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x) => typeof x === "string" ? JSON.stringify(x) : String(x);
function straight0() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e + "c"; }
function used0(e, v) { return e + "c"; }
function passed0() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used0(r[0], v); }
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e + "c") + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0());
function straight1() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e.length; }
function used1(e, v) { return e.length; }
function passed1() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used1(r[0], v); }
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e.length) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1());
function straight2() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e.toUpperCase(); }
function used2(e, v) { return e.toUpperCase(); }
function passed2() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used2(r[0], v); }
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e.toUpperCase()) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2());
function straight3() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return typeof e; }
function used3(e, v) { return typeof e; }
function passed3() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used3(r[0], v); }
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(typeof e) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3());
function straight4() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e === "ab"; }
function used4(e, v) { return e === "ab"; }
function passed4() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used4(r[0], v); }
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e === "ab") + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4());
function straight5() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e[0]; }
function used5(e, v) { return e[0]; }
function passed5() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used5(r[0], v); }
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e[0]) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5());
function straight6() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return Array.isArray(e); }
function used6(e, v) { return Array.isArray(e); }
function passed6() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used6(r[0], v); }
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(Array.isArray(e)) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6());
function straight7() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e.charCodeAt(1); }
function used7(e, v) { return e.charCodeAt(1); }
function passed7() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used7(r[0], v); }
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e.charCodeAt(1)) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7());
function straight8() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e < "b"; }
function used8(e, v) { return e < "b"; }
function passed8() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used8(r[0], v); }
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e < "b") + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8());
function straight9() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return `${e}!`; }
function used9(e, v) { return `${e}!`; }
function passed9() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used9(r[0], v); }
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(`${e}!`) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9());
function straight10() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return !e; }
function used10(e, v) { return !e; }
function passed10() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used10(r[0], v); }
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(!e) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
function straight11() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e == null; }
function used11(e, v) { return e == null; }
function passed11() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used11(r[0], v); }
function looped11() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e == null) + ","; } return all; }
console.log(11, show(straight11()), show(passed11()), looped11());
function straight12() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return e.slice(1); }
function used12(e, v) { return e.slice(1); }
function passed12() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used12(r[0], v); }
function looped12() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show(e.slice(1)) + ","; } return all; }
console.log(12, show(straight12()), show(passed12()), looped12());
function straight13() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; return [...e].length; }
function used13(e, v) { return [...e].length; }
function passed13() { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); return used13(r[0], v); }
function looped13() { let all = ""; for (let i = 0; i < 3; i++) { const v = "ab"; const w = "zz"; const r = [[[v]]].flat().flat(); const e = r[0]; all += show([...e].length) + ","; } return all; }
console.log(13, show(straight13()), show(passed13()), looped13());
