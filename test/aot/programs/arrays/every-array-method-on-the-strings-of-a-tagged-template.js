// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}

const tagc0 = (strings, ...rest) => strings;
function c0() { const S = tagc0`a${1}b${2}c`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function inc1(strings, ...rest) { const S = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c1() { return inc1`a${1}b${2}c`; }
const tagc2 = (strings, ...rest) => strings;
function hc2(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c2() { return hc2(tagc2`a${1}b${2}c`); }
const tagc3 = (strings, ...rest) => strings;
function c3() { const S = tagc3`a${1}b${2}c`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc4(strings, ...rest) { const S = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c4() { return inc4`a${1}b${2}c`; }
const tagc5 = (strings, ...rest) => strings;
function hc5(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c5() { return hc5(tagc5`a${1}b${2}c`); }
const tagc6 = (strings, ...rest) => strings;
function c6() { const S = tagc6`a${1}b${2}c`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc7(strings, ...rest) { const S = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c7() { return inc7`a${1}b${2}c`; }
const tagc8 = (strings, ...rest) => strings;
function hc8(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c8() { return hc8(tagc8`a${1}b${2}c`); }
const tagc9 = (strings, ...rest) => strings;
function c9() { const S = tagc9`a${1}b${2}c`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc10(strings, ...rest) { const S = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c10() { return inc10`a${1}b${2}c`; }
const tagc11 = (strings, ...rest) => strings;
function hc11(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c11() { return hc11(tagc11`a${1}b${2}c`); }
const tagc12 = (strings, ...rest) => strings;
function c12() { const S = tagc12`a${1}b${2}c`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function inc13(strings, ...rest) { const S = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c13() { return inc13`a${1}b${2}c`; }
const tagc14 = (strings, ...rest) => strings;
function hc14(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c14() { return hc14(tagc14`a${1}b${2}c`); }
const tagc15 = (strings, ...rest) => strings;
function c15() { const S = tagc15`a${1}b${2}c`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function inc16(strings, ...rest) { const S = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c16() { return inc16`a${1}b${2}c`; }
const tagc17 = (strings, ...rest) => strings;
function hc17(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c17() { return hc17(tagc17`a${1}b${2}c`); }
const tagc18 = (strings, ...rest) => strings;
function c18() { const S = tagc18`a${1}b${2}c`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc19(strings, ...rest) { const S = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c19() { return inc19`a${1}b${2}c`; }
const tagc20 = (strings, ...rest) => strings;
function hc20(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c20() { return hc20(tagc20`a${1}b${2}c`); }
const tagc21 = (strings, ...rest) => strings;
function c21() { const S = tagc21`a${1}b${2}c`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function inc22(strings, ...rest) { const S = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c22() { return inc22`a${1}b${2}c`; }
const tagc23 = (strings, ...rest) => strings;
function hc23(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c23() { return hc23(tagc23`a${1}b${2}c`); }
const tagc24 = (strings, ...rest) => strings;
function c24() { const S = tagc24`a${1}b${2}c`; const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function inc25(strings, ...rest) { const S = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c25() { return inc25`a${1}b${2}c`; }
const tagc26 = (strings, ...rest) => strings;
function hc26(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c26() { return hc26(tagc26`a${1}b${2}c`); }
const tagc27 = (strings, ...rest) => strings;
function c27() { const S = tagc27`a${1}b${2}c`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function inc28(strings, ...rest) { const S = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c28() { return inc28`a${1}b${2}c`; }
const tagc29 = (strings, ...rest) => strings;
function hc29(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c29() { return hc29(tagc29`a${1}b${2}c`); }
const tagc30 = (strings, ...rest) => strings;
function c30() { const S = tagc30`a${1}b${2}c`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function inc31(strings, ...rest) { const S = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c31() { return inc31`a${1}b${2}c`; }
const tagc32 = (strings, ...rest) => strings;
function hc32(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c32() { return hc32(tagc32`a${1}b${2}c`); }
const tagc33 = (strings, ...rest) => strings;
function c33() { const S = tagc33`a${1}b${2}c`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function inc34(strings, ...rest) { const S = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c34() { return inc34`a${1}b${2}c`; }
const tagc35 = (strings, ...rest) => strings;
function hc35(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c35() { return hc35(tagc35`a${1}b${2}c`); }
const tagc36 = (strings, ...rest) => strings;
function c36() { const S = tagc36`a${1}b${2}c`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc37(strings, ...rest) { const S = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c37() { return inc37`a${1}b${2}c`; }
const tagc38 = (strings, ...rest) => strings;
function hc38(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c38() { return hc38(tagc38`a${1}b${2}c`); }
const tagc39 = (strings, ...rest) => strings;
function c39() { const S = tagc39`a${1}b${2}c`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc40(strings, ...rest) { const S = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c40() { return inc40`a${1}b${2}c`; }
const tagc41 = (strings, ...rest) => strings;
function hc41(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c41() { return hc41(tagc41`a${1}b${2}c`); }
const tagc42 = (strings, ...rest) => strings;
function c42() { const S = tagc42`a${1}b${2}c`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function inc43(strings, ...rest) { const S = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c43() { return inc43`a${1}b${2}c`; }
const tagc44 = (strings, ...rest) => strings;
function hc44(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c44() { return hc44(tagc44`a${1}b${2}c`); }
const tagc45 = (strings, ...rest) => strings;
function c45() { const S = tagc45`a${1}b${2}c`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function inc46(strings, ...rest) { const S = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c46() { return inc46`a${1}b${2}c`; }
const tagc47 = (strings, ...rest) => strings;
function hc47(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c47() { return hc47(tagc47`a${1}b${2}c`); }
const tagc48 = (strings, ...rest) => strings;
function c48() { const S = tagc48`a${1}b${2}c`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function inc49(strings, ...rest) { const S = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c49() { return inc49`a${1}b${2}c`; }
const tagc50 = (strings, ...rest) => strings;
function hc50(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c50() { return hc50(tagc50`a${1}b${2}c`); }
const tagc51 = (strings, ...rest) => strings;
function c51() { const S = tagc51`a${1}b${2}c`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function inc52(strings, ...rest) { const S = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c52() { return inc52`a${1}b${2}c`; }
const tagc53 = (strings, ...rest) => strings;
function hc53(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c53() { return hc53(tagc53`a${1}b${2}c`); }
const tagc54 = (strings, ...rest) => strings;
function c54() { const S = tagc54`a${1}b${2}c`; return S.join("+") + "|" + S.join(); }
function inc55(strings, ...rest) { const S = strings; return S.join("+") + "|" + S.join(); }
function c55() { return inc55`a${1}b${2}c`; }
const tagc56 = (strings, ...rest) => strings;
function hc56(S) { return S.join("+") + "|" + S.join(); }
function c56() { return hc56(tagc56`a${1}b${2}c`); }
const tagc57 = (strings, ...rest) => strings;
function c57() { const S = tagc57`a${1}b${2}c`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function inc58(strings, ...rest) { const S = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c58() { return inc58`a${1}b${2}c`; }
const tagc59 = (strings, ...rest) => strings;
function hc59(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c59() { return hc59(tagc59`a${1}b${2}c`); }
const tagc60 = (strings, ...rest) => strings;
function c60() { const S = tagc60`a${1}b${2}c`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc61(strings, ...rest) { const S = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c61() { return inc61`a${1}b${2}c`; }
const tagc62 = (strings, ...rest) => strings;
function hc62(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c62() { return hc62(tagc62`a${1}b${2}c`); }
const tagc63 = (strings, ...rest) => strings;
function c63() { const S = tagc63`a${1}b${2}c`; return S.map(p => p + p).join(); }
function inc64(strings, ...rest) { const S = strings; return S.map(p => p + p).join(); }
function c64() { return inc64`a${1}b${2}c`; }
const tagc65 = (strings, ...rest) => strings;
function hc65(S) { return S.map(p => p + p).join(); }
function c65() { return hc65(tagc65`a${1}b${2}c`); }
const tagc66 = (strings, ...rest) => strings;
function c66() { const S = tagc66`a${1}b${2}c`; return S.map(p => typeof p).join(); }
function inc67(strings, ...rest) { const S = strings; return S.map(p => typeof p).join(); }
function c67() { return inc67`a${1}b${2}c`; }
const tagc68 = (strings, ...rest) => strings;
function hc68(S) { return S.map(p => typeof p).join(); }
function c68() { return hc68(tagc68`a${1}b${2}c`); }
const tagc69 = (strings, ...rest) => strings;
function c69() { const S = tagc69`a${1}b${2}c`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc70(strings, ...rest) { const S = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c70() { return inc70`a${1}b${2}c`; }
const tagc71 = (strings, ...rest) => strings;
function hc71(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c71() { return hc71(tagc71`a${1}b${2}c`); }
const tagc72 = (strings, ...rest) => strings;
function c72() { const S = tagc72`a${1}b${2}c`; return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function inc73(strings, ...rest) { const S = strings; return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c73() { return inc73`a${1}b${2}c`; }
const tagc74 = (strings, ...rest) => strings;
function hc74(S) { return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c74() { return hc74(tagc74`a${1}b${2}c`); }
const tagc75 = (strings, ...rest) => strings;
function c75() { const S = tagc75`a${1}b${2}c`; const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function inc76(strings, ...rest) { const S = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c76() { return inc76`a${1}b${2}c`; }
const tagc77 = (strings, ...rest) => strings;
function hc77(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c77() { return hc77(tagc77`a${1}b${2}c`); }
const tagc78 = (strings, ...rest) => strings;
function c78() { const S = tagc78`a${1}b${2}c`; return S.reduceRight((t, p) => t + typeof p + p, ""); }
function inc79(strings, ...rest) { const S = strings; return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c79() { return inc79`a${1}b${2}c`; }
const tagc80 = (strings, ...rest) => strings;
function hc80(S) { return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c80() { return hc80(tagc80`a${1}b${2}c`); }
const tagc81 = (strings, ...rest) => strings;
function c81() { const S = tagc81`a${1}b${2}c`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc82(strings, ...rest) { const S = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c82() { return inc82`a${1}b${2}c`; }
const tagc83 = (strings, ...rest) => strings;
function hc83(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c83() { return hc83(tagc83`a${1}b${2}c`); }
const tagc84 = (strings, ...rest) => strings;
function c84() { const S = tagc84`a${1}b${2}c`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function inc85(strings, ...rest) { const S = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c85() { return inc85`a${1}b${2}c`; }
const tagc86 = (strings, ...rest) => strings;
function hc86(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c86() { return hc86(tagc86`a${1}b${2}c`); }
const tagc87 = (strings, ...rest) => strings;
function c87() { const S = tagc87`a${1}b${2}c`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function inc88(strings, ...rest) { const S = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c88() { return inc88`a${1}b${2}c`; }
const tagc89 = (strings, ...rest) => strings;
function hc89(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c89() { return hc89(tagc89`a${1}b${2}c`); }
const tagc90 = (strings, ...rest) => strings;
function c90() { const S = tagc90`a${1}b${2}c`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc91(strings, ...rest) { const S = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c91() { return inc91`a${1}b${2}c`; }
const tagc92 = (strings, ...rest) => strings;
function hc92(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c92() { return hc92(tagc92`a${1}b${2}c`); }
const tagc93 = (strings, ...rest) => strings;
function c93() { const S = tagc93`a${1}b${2}c`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc94(strings, ...rest) { const S = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c94() { return inc94`a${1}b${2}c`; }
const tagc95 = (strings, ...rest) => strings;
function hc95(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c95() { return hc95(tagc95`a${1}b${2}c`); }
const tagc96 = (strings, ...rest) => strings;
function c96() { const S = tagc96`a${1}b${2}c`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc97(strings, ...rest) { const S = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c97() { return inc97`a${1}b${2}c`; }
const tagc98 = (strings, ...rest) => strings;
function hc98(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c98() { return hc98(tagc98`a${1}b${2}c`); }
const tagc99 = (strings, ...rest) => strings;
function c99() { const S = tagc99`a${1}b${2}c`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc100(strings, ...rest) { const S = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c100() { return inc100`a${1}b${2}c`; }
const tagc101 = (strings, ...rest) => strings;
function hc101(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c101() { return hc101(tagc101`a${1}b${2}c`); }
const tagc102 = (strings, ...rest) => strings;
function c102() { const S = tagc102`a${1}b${2}c`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function inc103(strings, ...rest) { const S = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c103() { return inc103`a${1}b${2}c`; }
const tagc104 = (strings, ...rest) => strings;
function hc104(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c104() { return hc104(tagc104`a${1}b${2}c`); }
const tagc105 = (strings, ...rest) => strings;
function c105() { const S = tagc105`a${1}b${2}c`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function inc106(strings, ...rest) { const S = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c106() { return inc106`a${1}b${2}c`; }
const tagc107 = (strings, ...rest) => strings;
function hc107(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c107() { return hc107(tagc107`a${1}b${2}c`); }
const tagc108 = (strings, ...rest) => strings;
function c108() { const S = tagc108`a${1}b${2}c`; let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function inc109(strings, ...rest) { const S = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c109() { return inc109`a${1}b${2}c`; }
const tagc110 = (strings, ...rest) => strings;
function hc110(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c110() { return hc110(tagc110`a${1}b${2}c`); }
const tagc111 = (strings, ...rest) => strings;
function c111() { const S = tagc111`a${1}b${2}c`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function inc112(strings, ...rest) { const S = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c112() { return inc112`a${1}b${2}c`; }
const tagc113 = (strings, ...rest) => strings;
function hc113(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c113() { return hc113(tagc113`a${1}b${2}c`); }
const tagc114 = (strings, ...rest) => strings;
function c114() { const S = tagc114`a${1}b${2}c`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function inc115(strings, ...rest) { const S = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c115() { return inc115`a${1}b${2}c`; }
const tagc116 = (strings, ...rest) => strings;
function hc116(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c116() { return hc116(tagc116`a${1}b${2}c`); }
const tagc117 = (strings, ...rest) => strings;
function c117() { const S = tagc117`a${1}b${2}c`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc118(strings, ...rest) { const S = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c118() { return inc118`a${1}b${2}c`; }
const tagc119 = (strings, ...rest) => strings;
function hc119(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c119() { return hc119(tagc119`a${1}b${2}c`); }
const tagc120 = (strings, ...rest) => strings;
function c120() { const S = tagc120`a${1}b${2}c`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function inc121(strings, ...rest) { const S = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c121() { return inc121`a${1}b${2}c`; }
const tagc122 = (strings, ...rest) => strings;
function hc122(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c122() { return hc122(tagc122`a${1}b${2}c`); }
const tagc123 = (strings, ...rest) => strings;
function c123() { const S = tagc123`a${1}b${2}c`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function inc124(strings, ...rest) { const S = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c124() { return inc124`a${1}b${2}c`; }
const tagc125 = (strings, ...rest) => strings;
function hc125(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c125() { return hc125(tagc125`a${1}b${2}c`); }
const tagc126 = (strings, ...rest) => strings;
function c126() { const S = tagc126`a${1}b${2}c`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc127(strings, ...rest) { const S = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c127() { return inc127`a${1}b${2}c`; }
const tagc128 = (strings, ...rest) => strings;
function hc128(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c128() { return hc128(tagc128`a${1}b${2}c`); }
const tagc129 = (strings, ...rest) => strings;
function c129() { const S = tagc129`a${1}b${2}c`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc130(strings, ...rest) { const S = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c130() { return inc130`a${1}b${2}c`; }
const tagc131 = (strings, ...rest) => strings;
function hc131(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c131() { return hc131(tagc131`a${1}b${2}c`); }
const tagc132 = (strings, ...rest) => strings;
function c132() { const S = tagc132`a${1}b${2}c`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc133(strings, ...rest) { const S = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c133() { return inc133`a${1}b${2}c`; }
const tagc134 = (strings, ...rest) => strings;
function hc134(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c134() { return hc134(tagc134`a${1}b${2}c`); }
const tagc135 = (strings, ...rest) => strings;
function c135() { const S = tagc135`a${1}b${2}c`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc136(strings, ...rest) { const S = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c136() { return inc136`a${1}b${2}c`; }
const tagc137 = (strings, ...rest) => strings;
function hc137(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c137() { return hc137(tagc137`a${1}b${2}c`); }
const tagc138 = (strings, ...rest) => strings;
function c138() { const S = tagc138`a${1}b${2}c`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function inc139(strings, ...rest) { const S = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c139() { return inc139`a${1}b${2}c`; }
const tagc140 = (strings, ...rest) => strings;
function hc140(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c140() { return hc140(tagc140`a${1}b${2}c`); }
const tagc141 = (strings, ...rest) => strings;
function c141() { const S = tagc141`a${1}b${2}c`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function inc142(strings, ...rest) { const S = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c142() { return inc142`a${1}b${2}c`; }
const tagc143 = (strings, ...rest) => strings;
function hc143(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c143() { return hc143(tagc143`a${1}b${2}c`); }
const tagc144 = (strings, ...rest) => strings;
function c144() { const S = tagc144`a${1}b${2}c`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc145(strings, ...rest) { const S = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c145() { return inc145`a${1}b${2}c`; }
const tagc146 = (strings, ...rest) => strings;
function hc146(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c146() { return hc146(tagc146`a${1}b${2}c`); }
const tagc147 = (strings, ...rest) => strings;
function c147() { const S = tagc147`a${1}b${2}c`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function inc148(strings, ...rest) { const S = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c148() { return inc148`a${1}b${2}c`; }
const tagc149 = (strings, ...rest) => strings;
function hc149(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c149() { return hc149(tagc149`a${1}b${2}c`); }
const tagc150 = (strings, ...rest) => strings;
function c150() { const S = tagc150`a${1}b${2}c`; return JSON.stringify(S); }
function inc151(strings, ...rest) { const S = strings; return JSON.stringify(S); }
function c151() { return inc151`a${1}b${2}c`; }
const tagc152 = (strings, ...rest) => strings;
function hc152(S) { return JSON.stringify(S); }
function c152() { return hc152(tagc152`a${1}b${2}c`); }
const tagc153 = (strings, ...rest) => strings;
function c153() { const S = tagc153`a${1}b${2}c`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function inc154(strings, ...rest) { const S = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c154() { return inc154`a${1}b${2}c`; }
const tagc155 = (strings, ...rest) => strings;
function hc155(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c155() { return hc155(tagc155`a${1}b${2}c`); }
const tagc156 = (strings, ...rest) => strings;
function c156() { const S = tagc156`a${1}b${2}c`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function inc157(strings, ...rest) { const S = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c157() { return inc157`a${1}b${2}c`; }
const tagc158 = (strings, ...rest) => strings;
function hc158(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c158() { return hc158(tagc158`a${1}b${2}c`); }
const tagc159 = (strings, ...rest) => strings;
function c159() { const S = tagc159`a${1}b${2}c`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc160(strings, ...rest) { const S = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c160() { return inc160`a${1}b${2}c`; }
const tagc161 = (strings, ...rest) => strings;
function hc161(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c161() { return hc161(tagc161`a${1}b${2}c`); }
const tagc162 = (strings, ...rest) => strings;
function c162() { const S = tagc162`a${1}b${2}c`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc163(strings, ...rest) { const S = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c163() { return inc163`a${1}b${2}c`; }
const tagc164 = (strings, ...rest) => strings;
function hc164(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c164() { return hc164(tagc164`a${1}b${2}c`); }
const tagc165 = (strings, ...rest) => strings;
function c165() { const S = tagc165`a${1}b${2}c`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function inc166(strings, ...rest) { const S = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c166() { return inc166`a${1}b${2}c`; }
const tagc167 = (strings, ...rest) => strings;
function hc167(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c167() { return hc167(tagc167`a${1}b${2}c`); }
const tagc168 = (strings, ...rest) => strings;
function c168() { const S = tagc168`a${1}b${2}c`; return String.raw({ raw: S }, 1, 2); }
function inc169(strings, ...rest) { const S = strings; return String.raw({ raw: S }, 1, 2); }
function c169() { return inc169`a${1}b${2}c`; }
const tagc170 = (strings, ...rest) => strings;
function hc170(S) { return String.raw({ raw: S }, 1, 2); }
function c170() { return hc170(tagc170`a${1}b${2}c`); }
const tagc171 = (strings, ...rest) => strings;
function c171() { const S = tagc171`a${1}b${2}c`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc172(strings, ...rest) { const S = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c172() { return inc172`a${1}b${2}c`; }
const tagc173 = (strings, ...rest) => strings;
function hc173(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c173() { return hc173(tagc173`a${1}b${2}c`); }
const tagc174 = (strings, ...rest) => strings;
function c174() { const S = tagc174`a${1}b${2}c`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function inc175(strings, ...rest) { const S = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c175() { return inc175`a${1}b${2}c`; }
const tagc176 = (strings, ...rest) => strings;
function hc176(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c176() { return hc176(tagc176`a${1}b${2}c`); }
const tagc177 = (strings, ...rest) => strings;
function c177() { const S = tagc177`a${1}b${2}c`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function inc178(strings, ...rest) { const S = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c178() { return inc178`a${1}b${2}c`; }
const tagc179 = (strings, ...rest) => strings;
function hc179(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c179() { return hc179(tagc179`a${1}b${2}c`); }
const tagc180 = (strings, ...rest) => strings;
function c180() { const S = tagc180`a${1}b${2}c`; S.push("x"); return "pushed"; }
function inc181(strings, ...rest) { const S = strings; S.push("x"); return "pushed"; }
function c181() { return inc181`a${1}b${2}c`; }
const tagc182 = (strings, ...rest) => strings;
function hc182(S) { S.push("x"); return "pushed"; }
function c182() { return hc182(tagc182`a${1}b${2}c`); }
const tagc183 = (strings, ...rest) => strings;
function c183() { const S = tagc183`a${1}b${2}c`; return "popped " + S.pop(); }
function inc184(strings, ...rest) { const S = strings; return "popped " + S.pop(); }
function c184() { return inc184`a${1}b${2}c`; }
const tagc185 = (strings, ...rest) => strings;
function hc185(S) { return "popped " + S.pop(); }
function c185() { return hc185(tagc185`a${1}b${2}c`); }
const tagc186 = (strings, ...rest) => strings;
function c186() { const S = tagc186`a${1}b${2}c`; return "shifted " + S.shift(); }
function inc187(strings, ...rest) { const S = strings; return "shifted " + S.shift(); }
function c187() { return inc187`a${1}b${2}c`; }
const tagc188 = (strings, ...rest) => strings;
function hc188(S) { return "shifted " + S.shift(); }
function c188() { return hc188(tagc188`a${1}b${2}c`); }
const tagc189 = (strings, ...rest) => strings;
function c189() { const S = tagc189`a${1}b${2}c`; S.unshift("x"); return "unshifted"; }
function inc190(strings, ...rest) { const S = strings; S.unshift("x"); return "unshifted"; }
function c190() { return inc190`a${1}b${2}c`; }
const tagc191 = (strings, ...rest) => strings;
function hc191(S) { S.unshift("x"); return "unshifted"; }
function c191() { return hc191(tagc191`a${1}b${2}c`); }
const tagc192 = (strings, ...rest) => strings;
function c192() { const S = tagc192`a${1}b${2}c`; return show(S.reverse()); }
function inc193(strings, ...rest) { const S = strings; return show(S.reverse()); }
function c193() { return inc193`a${1}b${2}c`; }
const tagc194 = (strings, ...rest) => strings;
function hc194(S) { return show(S.reverse()); }
function c194() { return hc194(tagc194`a${1}b${2}c`); }
const tagc195 = (strings, ...rest) => strings;
function c195() { const S = tagc195`a${1}b${2}c`; return show(S.sort()); }
function inc196(strings, ...rest) { const S = strings; return show(S.sort()); }
function c196() { return inc196`a${1}b${2}c`; }
const tagc197 = (strings, ...rest) => strings;
function hc197(S) { return show(S.sort()); }
function c197() { return hc197(tagc197`a${1}b${2}c`); }
const tagc198 = (strings, ...rest) => strings;
function c198() { const S = tagc198`a${1}b${2}c`; return show(S.splice(0, 1)); }
function inc199(strings, ...rest) { const S = strings; return show(S.splice(0, 1)); }
function c199() { return inc199`a${1}b${2}c`; }
const tagc200 = (strings, ...rest) => strings;
function hc200(S) { return show(S.splice(0, 1)); }
function c200() { return hc200(tagc200`a${1}b${2}c`); }
const tagc201 = (strings, ...rest) => strings;
function c201() { const S = tagc201`a${1}b${2}c`; return show(S.fill("f")); }
function inc202(strings, ...rest) { const S = strings; return show(S.fill("f")); }
function c202() { return inc202`a${1}b${2}c`; }
const tagc203 = (strings, ...rest) => strings;
function hc203(S) { return show(S.fill("f")); }
function c203() { return hc203(tagc203`a${1}b${2}c`); }
const tagc204 = (strings, ...rest) => strings;
function c204() { const S = tagc204`a${1}b${2}c`; return show(S.copyWithin(0, 1)); }
function inc205(strings, ...rest) { const S = strings; return show(S.copyWithin(0, 1)); }
function c205() { return inc205`a${1}b${2}c`; }
const tagc206 = (strings, ...rest) => strings;
function hc206(S) { return show(S.copyWithin(0, 1)); }
function c206() { return hc206(tagc206`a${1}b${2}c`); }
const tagc207 = (strings, ...rest) => strings;
function c207() { const S = tagc207`a${1}b${2}c`; "use strict"; S[0] = "x"; return "stored"; }
function inc208(strings, ...rest) { const S = strings; "use strict"; S[0] = "x"; return "stored"; }
function c208() { return inc208`a${1}b${2}c`; }
const tagc209 = (strings, ...rest) => strings;
function hc209(S) { "use strict"; S[0] = "x"; return "stored"; }
function c209() { return hc209(tagc209`a${1}b${2}c`); }
const tagc210 = (strings, ...rest) => strings;
function c210() { const S = tagc210`a${1}b${2}c`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function inc211(strings, ...rest) { const S = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c211() { return inc211`a${1}b${2}c`; }
const tagc212 = (strings, ...rest) => strings;
function hc212(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c212() { return hc212(tagc212`a${1}b${2}c`); }
const tagc213 = (strings, ...rest) => strings;
function c213() { const S = tagc213`a${1}b${2}c`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function inc214(strings, ...rest) { const S = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c214() { return inc214`a${1}b${2}c`; }
const tagc215 = (strings, ...rest) => strings;
function hc215(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c215() { return hc215(tagc215`a${1}b${2}c`); }
const cases = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

