// Every method of Array.prototype, and what else reads a list, on a frozen constant array of numbers: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}


function c0(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }

function hc1(S: readonly number[]): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c1(): string { return hc1(Object.freeze([1, 2, 3])); }

function c2(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc3(S: readonly number[]): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c3(): string { return hc3(Object.freeze([1, 2, 3])); }

function c4(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc5(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c5(): string { return hc5(Object.freeze([1, 2, 3])); }

function c6(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc7(S: readonly number[]): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c7(): string { return hc7(Object.freeze([1, 2, 3])); }

function c8(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }

function hc9(S: readonly number[]): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c9(): string { return hc9(Object.freeze([1, 2, 3])); }

function c10(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }

function hc11(S: readonly number[]): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c11(): string { return hc11(Object.freeze([1, 2, 3])); }

function c12(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc13(S: readonly number[]): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c13(): string { return hc13(Object.freeze([1, 2, 3])); }

function c14(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }

function hc15(S: readonly number[]): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c15(): string { return hc15(Object.freeze([1, 2, 3])); }

function c16(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.find(p => p !== undefined); return typeof r + ":" + r; }

function hc17(S: readonly number[]): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c17(): string { return hc17(Object.freeze([1, 2, 3])); }

function c18(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }

function hc19(S: readonly number[]): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c19(): string { return hc19(Object.freeze([1, 2, 3])); }

function c20(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }

function hc21(S: readonly number[]): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c21(): string { return hc21(Object.freeze([1, 2, 3])); }

function c22(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }

function hc23(S: readonly number[]): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c23(): string { return hc23(Object.freeze([1, 2, 3])); }

function c24(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc25(S: readonly number[]): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c25(): string { return hc25(Object.freeze([1, 2, 3])); }

function c26(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc27(S: readonly number[]): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c27(): string { return hc27(Object.freeze([1, 2, 3])); }

function c28(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }

function hc29(S: readonly number[]): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c29(): string { return hc29(Object.freeze([1, 2, 3])); }

function c30(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }

function hc31(S: readonly number[]): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c31(): string { return hc31(Object.freeze([1, 2, 3])); }

function c32(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }

function hc33(S: readonly number[]): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c33(): string { return hc33(Object.freeze([1, 2, 3])); }

function c34(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }

function hc35(S: readonly number[]): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c35(): string { return hc35(Object.freeze([1, 2, 3])); }

function c36(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.join("+") + "|" + S.join(); }

function hc37(S: readonly number[]): string { return S.join("+") + "|" + S.join(); }
function c37(): string { return hc37(Object.freeze([1, 2, 3])); }

function c38(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }

function hc39(S: readonly number[]): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c39(): string { return hc39(Object.freeze([1, 2, 3])); }

function c40(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc41(S: readonly number[]): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c41(): string { return hc41(Object.freeze([1, 2, 3])); }

function c42(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.map(p => p + p).join(); }

function hc43(S: readonly number[]): string { return S.map(p => p + p).join(); }
function c43(): string { return hc43(Object.freeze([1, 2, 3])); }

function c44(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.map(p => typeof p).join(); }

function hc45(S: readonly number[]): string { return S.map(p => typeof p).join(); }
function c45(): string { return hc45(Object.freeze([1, 2, 3])); }

function c46(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc47(S: readonly number[]): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c47(): string { return hc47(Object.freeze([1, 2, 3])); }

function c48(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.reduce((t, p, i) => t + typeof p + p + i, ""); }

function hc49(S: readonly number[]): string { return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c49(): string { return hc49(Object.freeze([1, 2, 3])); }

function c50(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.reduce((a, b) => a); return typeof r + ":" + r; }

function hc51(S: readonly number[]): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c51(): string { return hc51(Object.freeze([1, 2, 3])); }

function c52(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.reduceRight((t, p) => t + typeof p + p, ""); }

function hc53(S: readonly number[]): string { return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c53(): string { return hc53(Object.freeze([1, 2, 3])); }

function c54(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc55(S: readonly number[]): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c55(): string { return hc55(Object.freeze([1, 2, 3])); }

function c56(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }

function hc57(S: readonly number[]): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c57(): string { return hc57(Object.freeze([1, 2, 3])); }

function c58(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }

function hc59(S: readonly number[]): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c59(): string { return hc59(Object.freeze([1, 2, 3])); }

function c60(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc61(S: readonly number[]): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c61(): string { return hc61(Object.freeze([1, 2, 3])); }

function c62(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc63(S: readonly number[]): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c63(): string { return hc63(Object.freeze([1, 2, 3])); }

function c64(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc65(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c65(): string { return hc65(Object.freeze([1, 2, 3])); }

function c66(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc67(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c67(): string { return hc67(Object.freeze([1, 2, 3])); }

function c68(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }

function hc69(S: readonly number[]): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c69(): string { return hc69(Object.freeze([1, 2, 3])); }

function c70(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }

function hc71(S: readonly number[]): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c71(): string { return hc71(Object.freeze([1, 2, 3])); }

function c72(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const p of S) t += typeof p + p + ","; return t; }

function hc73(S: readonly number[]): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c73(): string { return hc73(Object.freeze([1, 2, 3])); }

function c74(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }

function hc75(S: readonly number[]): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c75(): string { return hc75(Object.freeze([1, 2, 3])); }

function c76(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }

function hc77(S: readonly number[]): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c77(): string { return hc77(Object.freeze([1, 2, 3])); }

function c78(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc79(S: readonly number[]): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c79(): string { return hc79(Object.freeze([1, 2, 3])); }

function c80(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }

function hc81(S: readonly number[]): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c81(): string { return hc81(Object.freeze([1, 2, 3])); }

function c82(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }

function hc83(S: readonly number[]): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c83(): string { return hc83(Object.freeze([1, 2, 3])); }

function c84(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc85(S: readonly number[]): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c85(): string { return hc85(Object.freeze([1, 2, 3])); }

function c86(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc87(S: readonly number[]): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c87(): string { return hc87(Object.freeze([1, 2, 3])); }

function c88(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc89(S: readonly number[]): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c89(): string { return hc89(Object.freeze([1, 2, 3])); }

function c90(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc91(S: readonly number[]): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c91(): string { return hc91(Object.freeze([1, 2, 3])); }

function c92(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }

function hc93(S: readonly number[]): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c93(): string { return hc93(Object.freeze([1, 2, 3])); }

function c94(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }

function hc95(S: readonly number[]): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c95(): string { return hc95(Object.freeze([1, 2, 3])); }

function c96(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc97(S: readonly number[]): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c97(): string { return hc97(Object.freeze([1, 2, 3])); }

function c98(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }

function hc99(S: readonly number[]): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c99(): string { return hc99(Object.freeze([1, 2, 3])); }

function c100(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return JSON.stringify(S); }

function hc101(S: readonly number[]): string { return JSON.stringify(S); }
function c101(): string { return hc101(Object.freeze([1, 2, 3])); }

function c102(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }

function hc103(S: readonly number[]): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c103(): string { return hc103(Object.freeze([1, 2, 3])); }

function c104(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }

function hc105(S: readonly number[]): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c105(): string { return hc105(Object.freeze([1, 2, 3])); }

function c106(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc107(S: readonly number[]): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c107(): string { return hc107(Object.freeze([1, 2, 3])); }

function c108(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc109(S: readonly number[]): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c109(): string { return hc109(Object.freeze([1, 2, 3])); }

function c110(): string { const S: any = Object.freeze([1, 2, 3]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }

function hc111(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c111(): string { return hc111(Object.freeze([1, 2, 3])); }

function c112(): string { const S: any = Object.freeze([1, 2, 3]); return String.raw({ raw: S }, 1, 2); }

function hc113(S: any): string { return String.raw({ raw: S }, 1, 2); }
function c113(): string { return hc113(Object.freeze([1, 2, 3])); }

function c114(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc115(S: readonly number[]): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c115(): string { return hc115(Object.freeze([1, 2, 3])); }

function c116(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }

function hc117(S: readonly number[]): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c117(): string { return hc117(Object.freeze([1, 2, 3])); }

function c118(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }

function hc119(S: readonly number[]): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c119(): string { return hc119(Object.freeze([1, 2, 3])); }

function c120(): string { const S: any = Object.freeze([1, 2, 3]); S.push("x"); return "pushed"; }

function hc121(S: any): string { S.push("x"); return "pushed"; }
function c121(): string { return hc121(Object.freeze([1, 2, 3])); }

function c122(): string { const S: any = Object.freeze([1, 2, 3]); return "popped " + S.pop(); }

function hc123(S: any): string { return "popped " + S.pop(); }
function c123(): string { return hc123(Object.freeze([1, 2, 3])); }

function c124(): string { const S: any = Object.freeze([1, 2, 3]); return "shifted " + S.shift(); }

function hc125(S: any): string { return "shifted " + S.shift(); }
function c125(): string { return hc125(Object.freeze([1, 2, 3])); }

function c126(): string { const S: any = Object.freeze([1, 2, 3]); S.unshift("x"); return "unshifted"; }

function hc127(S: any): string { S.unshift("x"); return "unshifted"; }
function c127(): string { return hc127(Object.freeze([1, 2, 3])); }

function c128(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.reverse()); }

function hc129(S: any): string { return show(S.reverse()); }
function c129(): string { return hc129(Object.freeze([1, 2, 3])); }

function c130(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.sort()); }

function hc131(S: any): string { return show(S.sort()); }
function c131(): string { return hc131(Object.freeze([1, 2, 3])); }

function c132(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.splice(0, 1)); }

function hc133(S: any): string { return show(S.splice(0, 1)); }
function c133(): string { return hc133(Object.freeze([1, 2, 3])); }

function c134(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.fill("f")); }

function hc135(S: any): string { return show(S.fill("f")); }
function c135(): string { return hc135(Object.freeze([1, 2, 3])); }

function c136(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.copyWithin(0, 1)); }

function hc137(S: any): string { return show(S.copyWithin(0, 1)); }
function c137(): string { return hc137(Object.freeze([1, 2, 3])); }

function c138(): string { const S: any = Object.freeze([1, 2, 3]); "use strict"; S[0] = "x"; return "stored"; }

function hc139(S: any): string { "use strict"; S[0] = "x"; return "stored"; }
function c139(): string { return hc139(Object.freeze([1, 2, 3])); }

function c140(): string { const S: any = Object.freeze([1, 2, 3]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }

function hc141(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c141(): string { return hc141(Object.freeze([1, 2, 3])); }

function c142(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }

function hc143(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c143(): string { return hc143(Object.freeze([1, 2, 3])); }
const cases: [string, () => string][] = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

