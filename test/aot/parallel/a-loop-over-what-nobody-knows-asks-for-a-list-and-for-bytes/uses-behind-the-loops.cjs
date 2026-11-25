// STATISTIC: ArrayOrUint8ArrayLoopsVersioned >= 5
// What a function reads off its parameter outside its loops and gives to a call, a condition or the result; and five that a loop begins with, names or is handed.
"use strict";
const out = [], names = JSON.parse('["tail","rest","made","mean","twice","horner","bound","first","given","kept"]');
const methods = {
  tail(d) { let s = 0, i = 0; for (; i + 2 < d.length; i += 3) s = (s + (d[i] << 16 | d[i + 1] << 8 | d[i + 2])) % 65521; if (i + 1 === d.length) s += d[i] >> 2; else if (i + 2 === d.length) s += d[i] << 4 | d[i + 1]; return s; },
  rest(d) { const l = []; let i = 0, from = 0; while (i + 3 < d.length) { if ((d[i] ^ d[i + 1]) & 1) { l.push(i - from); from = i; } i++; } l.push(d.length - from); for (; from < d.length; from++) l.push(d[from]); return l.join(); },
  made(d) { const l = new Uint8Array(d.length >>> 0 & 63); for (let i = 0; i < d.length; i++) l[i] = d[i] ^ 7; return l.join(); },
  mean(d) { let s = 0; for (let i = 0; i < d.length; i++) s = s + d[i] * 1; return s / d.length; },
  twice(d) { let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; for (let i = 0; i < d.length; i++) s = (s * 31 + d[i]) | 0; return s + d.length; },
  horner(d) { let s = 0; for (let i = d.length - 1; i >= 0; i--) s = s * 2 + d[i]; return s; },
  bound(d) { const n = d.length; let s = 0; for (let i = 0; i < n; i++) s = (s + d[i]) | 0; return s; },
  first(d) { let m = d[0]; for (let i = 1; i < d.length; i++) if (d[i] > m) m = d[i]; return m; },
  given(d) { const l = Array.from(d); let s = 0; for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; return s + l.length; },
  kept(d) { let s = 0; try { for (let i = 0; i < d.length; i++) s = (s + d[i]) | 0; } catch (e) { return e.name; } return s + (d.length & 1); },
};
const given = [[1, 2, 3, 4, 5, 6, 7], [1.5, -0, 3.25], [], [7], [1, , 3], [1, "2", null], [1n, 2n], new Uint8Array([1, 2, 3, 250]), Buffer.from([4, 5, 6, 7, 8]), new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), new Float64Array([0.5, 1.5]), new Uint8ClampedArray([300, 2]), "1234", { length: 2, 0: 5, 1: 6 }, { length: "2", 0: 1, 1: 1 }, { get length() { out.push("length"); return 1; }, get 0() { out.push("0"); return 3; } }, new Proxy([1, 2], {}), Object.assign([1, 2], { length: 1 }), null, undefined, 7, new (class extends Uint8Array {})(3)];
for (let r = 0; r < 30; r++) { out.length = 0; for (const name of names) for (const d of given) { try { out.push(String(methods[name](d))); } catch (e) { out.push(e.name); } } }
console.log(out.join("|"));
