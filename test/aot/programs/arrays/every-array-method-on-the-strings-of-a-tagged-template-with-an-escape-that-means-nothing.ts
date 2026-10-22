// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template with an escape that means nothing: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}

const tagc0 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c0(): string { const S: TemplateStringsArray = tagc0`\unicode${1}b${2}c`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function inc1(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c1(): string { return inc1`\unicode${1}b${2}c`; }
const tagc2 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc2(S: TemplateStringsArray): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c2(): string { return hc2(tagc2`\unicode${1}b${2}c`); }
const tagc3 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c3(): string { const S: TemplateStringsArray = tagc3`\unicode${1}b${2}c`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc4(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c4(): string { return inc4`\unicode${1}b${2}c`; }
const tagc5 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc5(S: TemplateStringsArray): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c5(): string { return hc5(tagc5`\unicode${1}b${2}c`); }
const tagc6 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c6(): string { const S: any = tagc6`\unicode${1}b${2}c`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc7(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c7(): string { return inc7`\unicode${1}b${2}c`; }
const tagc8 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc8(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c8(): string { return hc8(tagc8`\unicode${1}b${2}c`); }
const tagc9 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c9(): string { const S: TemplateStringsArray = tagc9`\unicode${1}b${2}c`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc10(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c10(): string { return inc10`\unicode${1}b${2}c`; }
const tagc11 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc11(S: TemplateStringsArray): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c11(): string { return hc11(tagc11`\unicode${1}b${2}c`); }
const tagc12 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c12(): string { const S: TemplateStringsArray = tagc12`\unicode${1}b${2}c`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function inc13(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c13(): string { return inc13`\unicode${1}b${2}c`; }
const tagc14 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc14(S: TemplateStringsArray): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c14(): string { return hc14(tagc14`\unicode${1}b${2}c`); }
const tagc15 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c15(): string { const S: TemplateStringsArray = tagc15`\unicode${1}b${2}c`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function inc16(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c16(): string { return inc16`\unicode${1}b${2}c`; }
const tagc17 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc17(S: TemplateStringsArray): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c17(): string { return hc17(tagc17`\unicode${1}b${2}c`); }
const tagc18 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c18(): string { const S: TemplateStringsArray = tagc18`\unicode${1}b${2}c`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc19(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c19(): string { return inc19`\unicode${1}b${2}c`; }
const tagc20 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc20(S: TemplateStringsArray): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c20(): string { return hc20(tagc20`\unicode${1}b${2}c`); }
const tagc21 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c21(): string { const S: TemplateStringsArray = tagc21`\unicode${1}b${2}c`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function inc22(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c22(): string { return inc22`\unicode${1}b${2}c`; }
const tagc23 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc23(S: TemplateStringsArray): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c23(): string { return hc23(tagc23`\unicode${1}b${2}c`); }
const tagc24 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c24(): string { const S: TemplateStringsArray = tagc24`\unicode${1}b${2}c`; const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function inc25(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c25(): string { return inc25`\unicode${1}b${2}c`; }
const tagc26 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc26(S: TemplateStringsArray): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c26(): string { return hc26(tagc26`\unicode${1}b${2}c`); }
const tagc27 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c27(): string { const S: TemplateStringsArray = tagc27`\unicode${1}b${2}c`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function inc28(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c28(): string { return inc28`\unicode${1}b${2}c`; }
const tagc29 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc29(S: TemplateStringsArray): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c29(): string { return hc29(tagc29`\unicode${1}b${2}c`); }
const tagc30 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c30(): string { const S: TemplateStringsArray = tagc30`\unicode${1}b${2}c`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function inc31(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c31(): string { return inc31`\unicode${1}b${2}c`; }
const tagc32 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc32(S: TemplateStringsArray): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c32(): string { return hc32(tagc32`\unicode${1}b${2}c`); }
const tagc33 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c33(): string { const S: TemplateStringsArray = tagc33`\unicode${1}b${2}c`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function inc34(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c34(): string { return inc34`\unicode${1}b${2}c`; }
const tagc35 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc35(S: TemplateStringsArray): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c35(): string { return hc35(tagc35`\unicode${1}b${2}c`); }
const tagc36 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c36(): string { const S: TemplateStringsArray = tagc36`\unicode${1}b${2}c`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc37(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c37(): string { return inc37`\unicode${1}b${2}c`; }
const tagc38 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc38(S: TemplateStringsArray): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c38(): string { return hc38(tagc38`\unicode${1}b${2}c`); }
const tagc39 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c39(): string { const S: TemplateStringsArray = tagc39`\unicode${1}b${2}c`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc40(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c40(): string { return inc40`\unicode${1}b${2}c`; }
const tagc41 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc41(S: TemplateStringsArray): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c41(): string { return hc41(tagc41`\unicode${1}b${2}c`); }
const tagc42 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c42(): string { const S: TemplateStringsArray = tagc42`\unicode${1}b${2}c`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function inc43(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c43(): string { return inc43`\unicode${1}b${2}c`; }
const tagc44 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc44(S: TemplateStringsArray): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c44(): string { return hc44(tagc44`\unicode${1}b${2}c`); }
const tagc45 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c45(): string { const S: TemplateStringsArray = tagc45`\unicode${1}b${2}c`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function inc46(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c46(): string { return inc46`\unicode${1}b${2}c`; }
const tagc47 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc47(S: TemplateStringsArray): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c47(): string { return hc47(tagc47`\unicode${1}b${2}c`); }
const tagc48 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c48(): string { const S: TemplateStringsArray = tagc48`\unicode${1}b${2}c`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function inc49(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c49(): string { return inc49`\unicode${1}b${2}c`; }
const tagc50 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc50(S: TemplateStringsArray): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c50(): string { return hc50(tagc50`\unicode${1}b${2}c`); }
const tagc51 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c51(): string { const S: TemplateStringsArray = tagc51`\unicode${1}b${2}c`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function inc52(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c52(): string { return inc52`\unicode${1}b${2}c`; }
const tagc53 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc53(S: TemplateStringsArray): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c53(): string { return hc53(tagc53`\unicode${1}b${2}c`); }
const tagc54 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c54(): string { const S: TemplateStringsArray = tagc54`\unicode${1}b${2}c`; return S.join("+") + "|" + S.join(); }
function inc55(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.join("+") + "|" + S.join(); }
function c55(): string { return inc55`\unicode${1}b${2}c`; }
const tagc56 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc56(S: TemplateStringsArray): string { return S.join("+") + "|" + S.join(); }
function c56(): string { return hc56(tagc56`\unicode${1}b${2}c`); }
const tagc57 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c57(): string { const S: TemplateStringsArray = tagc57`\unicode${1}b${2}c`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function inc58(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c58(): string { return inc58`\unicode${1}b${2}c`; }
const tagc59 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc59(S: TemplateStringsArray): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c59(): string { return hc59(tagc59`\unicode${1}b${2}c`); }
const tagc60 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c60(): string { const S: TemplateStringsArray = tagc60`\unicode${1}b${2}c`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc61(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c61(): string { return inc61`\unicode${1}b${2}c`; }
const tagc62 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc62(S: TemplateStringsArray): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c62(): string { return hc62(tagc62`\unicode${1}b${2}c`); }
const tagc63 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c63(): string { const S: TemplateStringsArray = tagc63`\unicode${1}b${2}c`; return S.map(p => p + p).join(); }
function inc64(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => p + p).join(); }
function c64(): string { return inc64`\unicode${1}b${2}c`; }
const tagc65 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc65(S: TemplateStringsArray): string { return S.map(p => p + p).join(); }
function c65(): string { return hc65(tagc65`\unicode${1}b${2}c`); }
const tagc66 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c66(): string { const S: TemplateStringsArray = tagc66`\unicode${1}b${2}c`; return S.map(p => typeof p).join(); }
function inc67(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => typeof p).join(); }
function c67(): string { return inc67`\unicode${1}b${2}c`; }
const tagc68 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc68(S: TemplateStringsArray): string { return S.map(p => typeof p).join(); }
function c68(): string { return hc68(tagc68`\unicode${1}b${2}c`); }
const tagc69 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c69(): string { const S: TemplateStringsArray = tagc69`\unicode${1}b${2}c`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc70(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c70(): string { return inc70`\unicode${1}b${2}c`; }
const tagc71 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc71(S: TemplateStringsArray): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c71(): string { return hc71(tagc71`\unicode${1}b${2}c`); }
const tagc72 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c72(): string { const S: TemplateStringsArray = tagc72`\unicode${1}b${2}c`; return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function inc73(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c73(): string { return inc73`\unicode${1}b${2}c`; }
const tagc74 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc74(S: TemplateStringsArray): string { return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c74(): string { return hc74(tagc74`\unicode${1}b${2}c`); }
const tagc75 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c75(): string { const S: TemplateStringsArray = tagc75`\unicode${1}b${2}c`; const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function inc76(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c76(): string { return inc76`\unicode${1}b${2}c`; }
const tagc77 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc77(S: TemplateStringsArray): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c77(): string { return hc77(tagc77`\unicode${1}b${2}c`); }
const tagc78 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c78(): string { const S: TemplateStringsArray = tagc78`\unicode${1}b${2}c`; return S.reduceRight((t, p) => t + typeof p + p, ""); }
function inc79(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c79(): string { return inc79`\unicode${1}b${2}c`; }
const tagc80 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc80(S: TemplateStringsArray): string { return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c80(): string { return hc80(tagc80`\unicode${1}b${2}c`); }
const tagc81 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c81(): string { const S: TemplateStringsArray = tagc81`\unicode${1}b${2}c`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc82(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c82(): string { return inc82`\unicode${1}b${2}c`; }
const tagc83 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc83(S: TemplateStringsArray): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c83(): string { return hc83(tagc83`\unicode${1}b${2}c`); }
const tagc84 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c84(): string { const S: TemplateStringsArray = tagc84`\unicode${1}b${2}c`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function inc85(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c85(): string { return inc85`\unicode${1}b${2}c`; }
const tagc86 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc86(S: TemplateStringsArray): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c86(): string { return hc86(tagc86`\unicode${1}b${2}c`); }
const tagc87 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c87(): string { const S: TemplateStringsArray = tagc87`\unicode${1}b${2}c`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function inc88(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c88(): string { return inc88`\unicode${1}b${2}c`; }
const tagc89 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc89(S: TemplateStringsArray): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c89(): string { return hc89(tagc89`\unicode${1}b${2}c`); }
const tagc90 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c90(): string { const S: TemplateStringsArray = tagc90`\unicode${1}b${2}c`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc91(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c91(): string { return inc91`\unicode${1}b${2}c`; }
const tagc92 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc92(S: TemplateStringsArray): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c92(): string { return hc92(tagc92`\unicode${1}b${2}c`); }
const tagc93 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c93(): string { const S: TemplateStringsArray = tagc93`\unicode${1}b${2}c`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc94(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c94(): string { return inc94`\unicode${1}b${2}c`; }
const tagc95 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc95(S: TemplateStringsArray): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c95(): string { return hc95(tagc95`\unicode${1}b${2}c`); }
const tagc96 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c96(): string { const S: any = tagc96`\unicode${1}b${2}c`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc97(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c97(): string { return inc97`\unicode${1}b${2}c`; }
const tagc98 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc98(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c98(): string { return hc98(tagc98`\unicode${1}b${2}c`); }
const tagc99 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c99(): string { const S: any = tagc99`\unicode${1}b${2}c`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc100(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c100(): string { return inc100`\unicode${1}b${2}c`; }
const tagc101 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc101(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c101(): string { return hc101(tagc101`\unicode${1}b${2}c`); }
const tagc102 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c102(): string { const S: TemplateStringsArray = tagc102`\unicode${1}b${2}c`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function inc103(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c103(): string { return inc103`\unicode${1}b${2}c`; }
const tagc104 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc104(S: TemplateStringsArray): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c104(): string { return hc104(tagc104`\unicode${1}b${2}c`); }
const tagc105 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c105(): string { const S: TemplateStringsArray = tagc105`\unicode${1}b${2}c`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function inc106(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c106(): string { return inc106`\unicode${1}b${2}c`; }
const tagc107 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc107(S: TemplateStringsArray): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c107(): string { return hc107(tagc107`\unicode${1}b${2}c`); }
const tagc108 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c108(): string { const S: TemplateStringsArray = tagc108`\unicode${1}b${2}c`; let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function inc109(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c109(): string { return inc109`\unicode${1}b${2}c`; }
const tagc110 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc110(S: TemplateStringsArray): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c110(): string { return hc110(tagc110`\unicode${1}b${2}c`); }
const tagc111 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c111(): string { const S: TemplateStringsArray = tagc111`\unicode${1}b${2}c`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function inc112(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c112(): string { return inc112`\unicode${1}b${2}c`; }
const tagc113 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc113(S: TemplateStringsArray): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c113(): string { return hc113(tagc113`\unicode${1}b${2}c`); }
const tagc114 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c114(): string { const S: TemplateStringsArray = tagc114`\unicode${1}b${2}c`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function inc115(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c115(): string { return inc115`\unicode${1}b${2}c`; }
const tagc116 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc116(S: TemplateStringsArray): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c116(): string { return hc116(tagc116`\unicode${1}b${2}c`); }
const tagc117 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c117(): string { const S: TemplateStringsArray = tagc117`\unicode${1}b${2}c`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc118(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c118(): string { return inc118`\unicode${1}b${2}c`; }
const tagc119 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc119(S: TemplateStringsArray): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c119(): string { return hc119(tagc119`\unicode${1}b${2}c`); }
const tagc120 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c120(): string { const S: TemplateStringsArray = tagc120`\unicode${1}b${2}c`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function inc121(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c121(): string { return inc121`\unicode${1}b${2}c`; }
const tagc122 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc122(S: TemplateStringsArray): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c122(): string { return hc122(tagc122`\unicode${1}b${2}c`); }
const tagc123 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c123(): string { const S: TemplateStringsArray = tagc123`\unicode${1}b${2}c`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function inc124(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c124(): string { return inc124`\unicode${1}b${2}c`; }
const tagc125 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc125(S: TemplateStringsArray): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c125(): string { return hc125(tagc125`\unicode${1}b${2}c`); }
const tagc126 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c126(): string { const S: TemplateStringsArray = tagc126`\unicode${1}b${2}c`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc127(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c127(): string { return inc127`\unicode${1}b${2}c`; }
const tagc128 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc128(S: TemplateStringsArray): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c128(): string { return hc128(tagc128`\unicode${1}b${2}c`); }
const tagc129 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c129(): string { const S: TemplateStringsArray = tagc129`\unicode${1}b${2}c`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc130(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c130(): string { return inc130`\unicode${1}b${2}c`; }
const tagc131 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc131(S: TemplateStringsArray): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c131(): string { return hc131(tagc131`\unicode${1}b${2}c`); }
const tagc132 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c132(): string { const S: TemplateStringsArray = tagc132`\unicode${1}b${2}c`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc133(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c133(): string { return inc133`\unicode${1}b${2}c`; }
const tagc134 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc134(S: TemplateStringsArray): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c134(): string { return hc134(tagc134`\unicode${1}b${2}c`); }
const tagc135 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c135(): string { const S: TemplateStringsArray = tagc135`\unicode${1}b${2}c`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc136(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c136(): string { return inc136`\unicode${1}b${2}c`; }
const tagc137 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc137(S: TemplateStringsArray): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c137(): string { return hc137(tagc137`\unicode${1}b${2}c`); }
const tagc138 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c138(): string { const S: TemplateStringsArray = tagc138`\unicode${1}b${2}c`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function inc139(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c139(): string { return inc139`\unicode${1}b${2}c`; }
const tagc140 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc140(S: TemplateStringsArray): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c140(): string { return hc140(tagc140`\unicode${1}b${2}c`); }
const tagc141 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c141(): string { const S: TemplateStringsArray = tagc141`\unicode${1}b${2}c`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function inc142(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c142(): string { return inc142`\unicode${1}b${2}c`; }
const tagc143 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc143(S: TemplateStringsArray): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c143(): string { return hc143(tagc143`\unicode${1}b${2}c`); }
const tagc144 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c144(): string { const S: TemplateStringsArray = tagc144`\unicode${1}b${2}c`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc145(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c145(): string { return inc145`\unicode${1}b${2}c`; }
const tagc146 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc146(S: TemplateStringsArray): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c146(): string { return hc146(tagc146`\unicode${1}b${2}c`); }
const tagc147 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c147(): string { const S: TemplateStringsArray = tagc147`\unicode${1}b${2}c`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function inc148(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c148(): string { return inc148`\unicode${1}b${2}c`; }
const tagc149 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc149(S: TemplateStringsArray): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c149(): string { return hc149(tagc149`\unicode${1}b${2}c`); }
const tagc150 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c150(): string { const S: TemplateStringsArray = tagc150`\unicode${1}b${2}c`; return JSON.stringify(S); }
function inc151(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return JSON.stringify(S); }
function c151(): string { return inc151`\unicode${1}b${2}c`; }
const tagc152 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc152(S: TemplateStringsArray): string { return JSON.stringify(S); }
function c152(): string { return hc152(tagc152`\unicode${1}b${2}c`); }
const tagc153 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c153(): string { const S: TemplateStringsArray = tagc153`\unicode${1}b${2}c`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function inc154(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c154(): string { return inc154`\unicode${1}b${2}c`; }
const tagc155 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc155(S: TemplateStringsArray): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c155(): string { return hc155(tagc155`\unicode${1}b${2}c`); }
const tagc156 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c156(): string { const S: TemplateStringsArray = tagc156`\unicode${1}b${2}c`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function inc157(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c157(): string { return inc157`\unicode${1}b${2}c`; }
const tagc158 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc158(S: TemplateStringsArray): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c158(): string { return hc158(tagc158`\unicode${1}b${2}c`); }
const tagc159 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c159(): string { const S: TemplateStringsArray = tagc159`\unicode${1}b${2}c`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc160(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c160(): string { return inc160`\unicode${1}b${2}c`; }
const tagc161 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc161(S: TemplateStringsArray): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c161(): string { return hc161(tagc161`\unicode${1}b${2}c`); }
const tagc162 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c162(): string { const S: TemplateStringsArray = tagc162`\unicode${1}b${2}c`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc163(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c163(): string { return inc163`\unicode${1}b${2}c`; }
const tagc164 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc164(S: TemplateStringsArray): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c164(): string { return hc164(tagc164`\unicode${1}b${2}c`); }
const tagc165 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c165(): string { const S: any = tagc165`\unicode${1}b${2}c`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function inc166(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c166(): string { return inc166`\unicode${1}b${2}c`; }
const tagc167 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc167(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c167(): string { return hc167(tagc167`\unicode${1}b${2}c`); }
const tagc168 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c168(): string { const S: any = tagc168`\unicode${1}b${2}c`; return String.raw({ raw: S }, 1, 2); }
function inc169(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.raw({ raw: S }, 1, 2); }
function c169(): string { return inc169`\unicode${1}b${2}c`; }
const tagc170 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc170(S: any): string { return String.raw({ raw: S }, 1, 2); }
function c170(): string { return hc170(tagc170`\unicode${1}b${2}c`); }
const tagc171 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c171(): string { const S: TemplateStringsArray = tagc171`\unicode${1}b${2}c`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function inc172(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c172(): string { return inc172`\unicode${1}b${2}c`; }
const tagc173 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc173(S: TemplateStringsArray): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c173(): string { return hc173(tagc173`\unicode${1}b${2}c`); }
const tagc174 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c174(): string { const S: TemplateStringsArray = tagc174`\unicode${1}b${2}c`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function inc175(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c175(): string { return inc175`\unicode${1}b${2}c`; }
const tagc176 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc176(S: TemplateStringsArray): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c176(): string { return hc176(tagc176`\unicode${1}b${2}c`); }
const tagc177 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c177(): string { const S: TemplateStringsArray = tagc177`\unicode${1}b${2}c`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function inc178(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c178(): string { return inc178`\unicode${1}b${2}c`; }
const tagc179 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc179(S: TemplateStringsArray): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c179(): string { return hc179(tagc179`\unicode${1}b${2}c`); }
const tagc180 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c180(): string { const S: any = tagc180`\unicode${1}b${2}c`; S.push("x"); return "pushed"; }
function inc181(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.push("x"); return "pushed"; }
function c181(): string { return inc181`\unicode${1}b${2}c`; }
const tagc182 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc182(S: any): string { S.push("x"); return "pushed"; }
function c182(): string { return hc182(tagc182`\unicode${1}b${2}c`); }
const tagc183 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c183(): string { const S: any = tagc183`\unicode${1}b${2}c`; return "popped " + S.pop(); }
function inc184(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "popped " + S.pop(); }
function c184(): string { return inc184`\unicode${1}b${2}c`; }
const tagc185 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc185(S: any): string { return "popped " + S.pop(); }
function c185(): string { return hc185(tagc185`\unicode${1}b${2}c`); }
const tagc186 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c186(): string { const S: any = tagc186`\unicode${1}b${2}c`; return "shifted " + S.shift(); }
function inc187(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "shifted " + S.shift(); }
function c187(): string { return inc187`\unicode${1}b${2}c`; }
const tagc188 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc188(S: any): string { return "shifted " + S.shift(); }
function c188(): string { return hc188(tagc188`\unicode${1}b${2}c`); }
const tagc189 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c189(): string { const S: any = tagc189`\unicode${1}b${2}c`; S.unshift("x"); return "unshifted"; }
function inc190(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.unshift("x"); return "unshifted"; }
function c190(): string { return inc190`\unicode${1}b${2}c`; }
const tagc191 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc191(S: any): string { S.unshift("x"); return "unshifted"; }
function c191(): string { return hc191(tagc191`\unicode${1}b${2}c`); }
const tagc192 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c192(): string { const S: any = tagc192`\unicode${1}b${2}c`; return show(S.reverse()); }
function inc193(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.reverse()); }
function c193(): string { return inc193`\unicode${1}b${2}c`; }
const tagc194 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc194(S: any): string { return show(S.reverse()); }
function c194(): string { return hc194(tagc194`\unicode${1}b${2}c`); }
const tagc195 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c195(): string { const S: any = tagc195`\unicode${1}b${2}c`; return show(S.sort()); }
function inc196(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.sort()); }
function c196(): string { return inc196`\unicode${1}b${2}c`; }
const tagc197 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc197(S: any): string { return show(S.sort()); }
function c197(): string { return hc197(tagc197`\unicode${1}b${2}c`); }
const tagc198 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c198(): string { const S: any = tagc198`\unicode${1}b${2}c`; return show(S.splice(0, 1)); }
function inc199(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.splice(0, 1)); }
function c199(): string { return inc199`\unicode${1}b${2}c`; }
const tagc200 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc200(S: any): string { return show(S.splice(0, 1)); }
function c200(): string { return hc200(tagc200`\unicode${1}b${2}c`); }
const tagc201 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c201(): string { const S: any = tagc201`\unicode${1}b${2}c`; return show(S.fill("f")); }
function inc202(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.fill("f")); }
function c202(): string { return inc202`\unicode${1}b${2}c`; }
const tagc203 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc203(S: any): string { return show(S.fill("f")); }
function c203(): string { return hc203(tagc203`\unicode${1}b${2}c`); }
const tagc204 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c204(): string { const S: any = tagc204`\unicode${1}b${2}c`; return show(S.copyWithin(0, 1)); }
function inc205(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.copyWithin(0, 1)); }
function c205(): string { return inc205`\unicode${1}b${2}c`; }
const tagc206 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc206(S: any): string { return show(S.copyWithin(0, 1)); }
function c206(): string { return hc206(tagc206`\unicode${1}b${2}c`); }
const tagc207 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c207(): string { const S: any = tagc207`\unicode${1}b${2}c`; "use strict"; S[0] = "x"; return "stored"; }
function inc208(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; "use strict"; S[0] = "x"; return "stored"; }
function c208(): string { return inc208`\unicode${1}b${2}c`; }
const tagc209 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc209(S: any): string { "use strict"; S[0] = "x"; return "stored"; }
function c209(): string { return hc209(tagc209`\unicode${1}b${2}c`); }
const tagc210 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c210(): string { const S: any = tagc210`\unicode${1}b${2}c`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function inc211(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c211(): string { return inc211`\unicode${1}b${2}c`; }
const tagc212 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc212(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c212(): string { return hc212(tagc212`\unicode${1}b${2}c`); }
const tagc213 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c213(): string { const S: any = tagc213`\unicode${1}b${2}c`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function inc214(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c214(): string { return inc214`\unicode${1}b${2}c`; }
const tagc215 = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc215(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c215(): string { return hc215(tagc215`\unicode${1}b${2}c`); }
const cases: [string, () => string][] = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

