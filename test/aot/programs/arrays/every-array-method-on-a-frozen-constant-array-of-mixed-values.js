// Every method of Array.prototype, and what else reads a list, on a frozen constant array of mixed values: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}


function c0() { const S = Object.freeze(["a", 2, null]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }

function hc1(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q; }
function c1() { return hc1(Object.freeze(["a", 2, null])); }

function c2() { const S = Object.freeze(["a", 2, null]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc3(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c3() { return hc3(Object.freeze(["a", 2, null])); }

function c4() { const S = Object.freeze(["a", 2, null]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc5(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c5() { return hc5(Object.freeze(["a", 2, null])); }

function c6() { const S = Object.freeze(["a", 2, null]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc7(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c7() { return hc7(Object.freeze(["a", 2, null])); }

function c8() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }

function hc9(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t; }
function c9() { return hc9(Object.freeze(["a", 2, null])); }

function c10() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }

function hc11(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t; }
function c11() { return hc11(Object.freeze(["a", 2, null])); }

function c12() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc13(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c13() { return hc13(Object.freeze(["a", 2, null])); }

function c14() { const S = Object.freeze(["a", 2, null]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }

function hc15(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+"); }
function c15() { return hc15(Object.freeze(["a", 2, null])); }

function c16() { const S = Object.freeze(["a", 2, null]); const r = S.find(p => p !== undefined); return typeof r + ":" + r; }

function hc17(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r; }
function c17() { return hc17(Object.freeze(["a", 2, null])); }

function c18() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }

function hc19(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t; }
function c19() { return hc19(Object.freeze(["a", 2, null])); }

function c20() { const S = Object.freeze(["a", 2, null]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }

function hc21(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r; }
function c21() { return hc21(Object.freeze(["a", 2, null])); }

function c22() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }

function hc23(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t; }
function c23() { return hc23(Object.freeze(["a", 2, null])); }

function c24() { const S = Object.freeze(["a", 2, null]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc25(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c25() { return hc25(Object.freeze(["a", 2, null])); }

function c26() { const S = Object.freeze(["a", 2, null]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc27(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c27() { return hc27(Object.freeze(["a", 2, null])); }

function c28() { const S = Object.freeze(["a", 2, null]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }

function hc29(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t; }
function c29() { return hc29(Object.freeze(["a", 2, null])); }

function c30() { const S = Object.freeze(["a", 2, null]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }

function hc31(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t; }
function c31() { return hc31(Object.freeze(["a", 2, null])); }

function c32() { const S = Object.freeze(["a", 2, null]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }

function hc33(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing"); }
function c33() { return hc33(Object.freeze(["a", 2, null])); }

function c34() { const S = Object.freeze(["a", 2, null]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }

function hc35(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1]); }
function c35() { return hc35(Object.freeze(["a", 2, null])); }

function c36() { const S = Object.freeze(["a", 2, null]); return S.join("+") + "|" + S.join(); }

function hc37(S) { return S.join("+") + "|" + S.join(); }
function c37() { return hc37(Object.freeze(["a", 2, null])); }

function c38() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }

function hc39(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t; }
function c39() { return hc39(Object.freeze(["a", 2, null])); }

function c40() { const S = Object.freeze(["a", 2, null]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc41(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c41() { return hc41(Object.freeze(["a", 2, null])); }

function c42() { const S = Object.freeze(["a", 2, null]); return S.map(p => p + p).join(); }

function hc43(S) { return S.map(p => p + p).join(); }
function c43() { return hc43(Object.freeze(["a", 2, null])); }

function c44() { const S = Object.freeze(["a", 2, null]); return S.map(p => typeof p).join(); }

function hc45(S) { return S.map(p => typeof p).join(); }
function c45() { return hc45(Object.freeze(["a", 2, null])); }

function c46() { const S = Object.freeze(["a", 2, null]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc47(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c47() { return hc47(Object.freeze(["a", 2, null])); }

function c48() { const S = Object.freeze(["a", 2, null]); return S.reduce((t, p, i) => t + typeof p + p + i, ""); }

function hc49(S) { return S.reduce((t, p, i) => t + typeof p + p + i, ""); }
function c49() { return hc49(Object.freeze(["a", 2, null])); }

function c50() { const S = Object.freeze(["a", 2, null]); const r = S.reduce((a, b) => a); return typeof r + ":" + r; }

function hc51(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r; }
function c51() { return hc51(Object.freeze(["a", 2, null])); }

function c52() { const S = Object.freeze(["a", 2, null]); return S.reduceRight((t, p) => t + typeof p + p, ""); }

function hc53(S) { return S.reduceRight((t, p) => t + typeof p + p, ""); }
function c53() { return hc53(Object.freeze(["a", 2, null])); }

function c54() { const S = Object.freeze(["a", 2, null]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc55(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c55() { return hc55(Object.freeze(["a", 2, null])); }

function c56() { const S = Object.freeze(["a", 2, null]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }

function hc57(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length; }
function c57() { return hc57(Object.freeze(["a", 2, null])); }

function c58() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }

function hc59(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t; }
function c59() { return hc59(Object.freeze(["a", 2, null])); }

function c60() { const S = Object.freeze(["a", 2, null]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc61(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c61() { return hc61(Object.freeze(["a", 2, null])); }

function c62() { const S = Object.freeze(["a", 2, null]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc63(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c63() { return hc63(Object.freeze(["a", 2, null])); }

function c64() { const S = Object.freeze(["a", 2, null]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc65(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c65() { return hc65(Object.freeze(["a", 2, null])); }

function c66() { const S = Object.freeze(["a", 2, null]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc67(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c67() { return hc67(Object.freeze(["a", 2, null])); }

function c68() { const S = Object.freeze(["a", 2, null]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }

function hc69(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + `${S}` + "|" + (S + ""); }
function c69() { return hc69(Object.freeze(["a", 2, null])); }

function c70() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }

function hc71(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t; }
function c71() { return hc71(Object.freeze(["a", 2, null])); }

function c72() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const p of S) t += typeof p + p + ","; return t; }

function hc73(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t; }
function c73() { return hc73(Object.freeze(["a", 2, null])); }

function c74() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }

function hc75(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t; }
function c75() { return hc75(Object.freeze(["a", 2, null])); }

function c76() { const S = Object.freeze(["a", 2, null]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }

function hc77(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t; }
function c77() { return hc77(Object.freeze(["a", 2, null])); }

function c78() { const S = Object.freeze(["a", 2, null]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc79(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c79() { return hc79(Object.freeze(["a", 2, null])); }

function c80() { const S = Object.freeze(["a", 2, null]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }

function hc81(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S); }
function c81() { return hc81(Object.freeze(["a", 2, null])); }

function c82() { const S = Object.freeze(["a", 2, null]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }

function hc83(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c); }
function c83() { return hc83(Object.freeze(["a", 2, null])); }

function c84() { const S = Object.freeze(["a", 2, null]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc85(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c85() { return hc85(Object.freeze(["a", 2, null])); }

function c86() { const S = Object.freeze(["a", 2, null]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc87(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c87() { return hc87(Object.freeze(["a", 2, null])); }

function c88() { const S = Object.freeze(["a", 2, null]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc89(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c89() { return hc89(Object.freeze(["a", 2, null])); }

function c90() { const S = Object.freeze(["a", 2, null]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc91(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c91() { return hc91(Object.freeze(["a", 2, null])); }

function c92() { const S = Object.freeze(["a", 2, null]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }

function hc93(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length; }
function c93() { return hc93(Object.freeze(["a", 2, null])); }

function c94() { const S = Object.freeze(["a", 2, null]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }

function hc95(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join(); }
function c95() { return hc95(Object.freeze(["a", 2, null])); }

function c96() { const S = Object.freeze(["a", 2, null]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc97(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c97() { return hc97(Object.freeze(["a", 2, null])); }

function c98() { const S = Object.freeze(["a", 2, null]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }

function hc99(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join(); }
function c99() { return hc99(Object.freeze(["a", 2, null])); }

function c100() { const S = Object.freeze(["a", 2, null]); return JSON.stringify(S); }

function hc101(S) { return JSON.stringify(S); }
function c101() { return hc101(Object.freeze(["a", 2, null])); }

function c102() { const S = Object.freeze(["a", 2, null]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }

function hc103(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0]); }
function c103() { return hc103(Object.freeze(["a", 2, null])); }

function c104() { const S = Object.freeze(["a", 2, null]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }

function hc105(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t; }
function c105() { return hc105(Object.freeze(["a", 2, null])); }

function c106() { const S = Object.freeze(["a", 2, null]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc107(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c107() { return hc107(Object.freeze(["a", 2, null])); }

function c108() { const S = Object.freeze(["a", 2, null]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc109(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c109() { return hc109(Object.freeze(["a", 2, null])); }

function c110() { const S = Object.freeze(["a", 2, null]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }

function hc111(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S); }
function c111() { return hc111(Object.freeze(["a", 2, null])); }

function c112() { const S = Object.freeze(["a", 2, null]); return String.raw({ raw: S }, 1, 2); }

function hc113(S) { return String.raw({ raw: S }, 1, 2); }
function c113() { return hc113(Object.freeze(["a", 2, null])); }

function c114() { const S = Object.freeze(["a", 2, null]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }

function hc115(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r); }
function c115() { return hc115(Object.freeze(["a", 2, null])); }

function c116() { const S = Object.freeze(["a", 2, null]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }

function hc117(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1); }
function c117() { return hc117(Object.freeze(["a", 2, null])); }

function c118() { const S = Object.freeze(["a", 2, null]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }

function hc119(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable; }
function c119() { return hc119(Object.freeze(["a", 2, null])); }

function c120() { const S = Object.freeze(["a", 2, null]); S.push("x"); return "pushed"; }

function hc121(S) { S.push("x"); return "pushed"; }
function c121() { return hc121(Object.freeze(["a", 2, null])); }

function c122() { const S = Object.freeze(["a", 2, null]); return "popped " + S.pop(); }

function hc123(S) { return "popped " + S.pop(); }
function c123() { return hc123(Object.freeze(["a", 2, null])); }

function c124() { const S = Object.freeze(["a", 2, null]); return "shifted " + S.shift(); }

function hc125(S) { return "shifted " + S.shift(); }
function c125() { return hc125(Object.freeze(["a", 2, null])); }

function c126() { const S = Object.freeze(["a", 2, null]); S.unshift("x"); return "unshifted"; }

function hc127(S) { S.unshift("x"); return "unshifted"; }
function c127() { return hc127(Object.freeze(["a", 2, null])); }

function c128() { const S = Object.freeze(["a", 2, null]); return show(S.reverse()); }

function hc129(S) { return show(S.reverse()); }
function c129() { return hc129(Object.freeze(["a", 2, null])); }

function c130() { const S = Object.freeze(["a", 2, null]); return show(S.sort()); }

function hc131(S) { return show(S.sort()); }
function c131() { return hc131(Object.freeze(["a", 2, null])); }

function c132() { const S = Object.freeze(["a", 2, null]); return show(S.splice(0, 1)); }

function hc133(S) { return show(S.splice(0, 1)); }
function c133() { return hc133(Object.freeze(["a", 2, null])); }

function c134() { const S = Object.freeze(["a", 2, null]); return show(S.fill("f")); }

function hc135(S) { return show(S.fill("f")); }
function c135() { return hc135(Object.freeze(["a", 2, null])); }

function c136() { const S = Object.freeze(["a", 2, null]); return show(S.copyWithin(0, 1)); }

function hc137(S) { return show(S.copyWithin(0, 1)); }
function c137() { return hc137(Object.freeze(["a", 2, null])); }

function c138() { const S = Object.freeze(["a", 2, null]); "use strict"; S[0] = "x"; return "stored"; }

function hc139(S) { "use strict"; S[0] = "x"; return "stored"; }
function c139() { return hc139(Object.freeze(["a", 2, null])); }

function c140() { const S = Object.freeze(["a", 2, null]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }

function hc141(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/"); }
function c141() { return hc141(Object.freeze(["a", 2, null])); }

function c142() { const S = Object.freeze(["a", 2, null]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }

function hc143(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0]); }
function c143() { return hc143(Object.freeze(["a", 2, null])); }
const cases = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

