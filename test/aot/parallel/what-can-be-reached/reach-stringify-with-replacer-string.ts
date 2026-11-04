// What comes out of stringify with replacer is used as what it is (string, typed).
type T = string;
function flatten(l: T[][]): T[] { return l.flat(); }
function pushed(x: T): T[][] { const outer: T[][] = []; for (let i = 0; i < 2; i++) { const inner: T[] = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l: T[][]): T[] { const seen: T[] = []; JSON.stringify(l, function (k: string, val: any) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
const show = (x: unknown) => typeof x === "string" ? JSON.stringify(x) : String(x);
function straight0() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e + "c"; }
function used0(e: T, v: T) { return e + "c"; }
function passed0() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used0(r[0] as T, v); }
function looped0() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e + "c") + ","; } return all; }
console.log(0, show(straight0()), show(passed0()), looped0());
function straight1() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e.length; }
function used1(e: T, v: T) { return e.length; }
function passed1() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used1(r[0] as T, v); }
function looped1() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e.length) + ","; } return all; }
console.log(1, show(straight1()), show(passed1()), looped1());
function straight2() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e.toUpperCase(); }
function used2(e: T, v: T) { return e.toUpperCase(); }
function passed2() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used2(r[0] as T, v); }
function looped2() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e.toUpperCase()) + ","; } return all; }
console.log(2, show(straight2()), show(passed2()), looped2());
function straight3() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return typeof e; }
function used3(e: T, v: T) { return typeof e; }
function passed3() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used3(r[0] as T, v); }
function looped3() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(typeof e) + ","; } return all; }
console.log(3, show(straight3()), show(passed3()), looped3());
function straight4() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e === "ab"; }
function used4(e: T, v: T) { return e === "ab"; }
function passed4() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used4(r[0] as T, v); }
function looped4() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e === "ab") + ","; } return all; }
console.log(4, show(straight4()), show(passed4()), looped4());
function straight5() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e[0]; }
function used5(e: T, v: T) { return e[0]; }
function passed5() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used5(r[0] as T, v); }
function looped5() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e[0]) + ","; } return all; }
console.log(5, show(straight5()), show(passed5()), looped5());
function straight6() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return Array.isArray(e); }
function used6(e: T, v: T) { return Array.isArray(e); }
function passed6() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used6(r[0] as T, v); }
function looped6() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(Array.isArray(e)) + ","; } return all; }
console.log(6, show(straight6()), show(passed6()), looped6());
function straight7() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e.charCodeAt(1); }
function used7(e: T, v: T) { return e.charCodeAt(1); }
function passed7() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used7(r[0] as T, v); }
function looped7() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e.charCodeAt(1)) + ","; } return all; }
console.log(7, show(straight7()), show(passed7()), looped7());
function straight8() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e < "b"; }
function used8(e: T, v: T) { return e < "b"; }
function passed8() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used8(r[0] as T, v); }
function looped8() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e < "b") + ","; } return all; }
console.log(8, show(straight8()), show(passed8()), looped8());
function straight9() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return `${e}!`; }
function used9(e: T, v: T) { return `${e}!`; }
function passed9() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used9(r[0] as T, v); }
function looped9() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(`${e}!`) + ","; } return all; }
console.log(9, show(straight9()), show(passed9()), looped9());
function straight10() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return !e; }
function used10(e: T, v: T) { return !e; }
function passed10() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used10(r[0] as T, v); }
function looped10() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(!e) + ","; } return all; }
console.log(10, show(straight10()), show(passed10()), looped10());
function straight11() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e == null; }
function used11(e: T, v: T) { return e == null; }
function passed11() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used11(r[0] as T, v); }
function looped11() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e == null) + ","; } return all; }
console.log(11, show(straight11()), show(passed11()), looped11());
function straight12() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return e.slice(1); }
function used12(e: T, v: T) { return e.slice(1); }
function passed12() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used12(r[0] as T, v); }
function looped12() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show(e.slice(1)) + ","; } return all; }
console.log(12, show(straight12()), show(passed12()), looped12());
function straight13() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; return [...e].length; }
function used13(e: T, v: T) { return [...e].length; }
function passed13() { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); return used13(r[0] as T, v); }
function looped13() { let all = ""; for (let i = 0; i < 3; i++) { const v: T = "ab"; const w: T = "zz"; const r: any = seenBy([[v]]); const e: T = r[0] as T; all += show([...e].length) + ","; } return all; }
console.log(13, show(straight13()), show(passed13()), looped13());
