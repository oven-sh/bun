// Rounds of hashes: a constant trip count, words that are others of the next iteration, a ring of words under a masked counter. Blocks, tables and states of every kind, one array in two places, words past 32 bits, loops that leave in the middle.
"use strict";
var log = [];
function fill(n, f) { var a = []; for (var i = 0; i < n; i++) a.push(f(i)); return a; }
function word(i) { return Math.imul(i + 1, 0x9e3779b9) | 0; }
function ring(f, b, g) {
  var c, d, e, h = f[0], k = f[1], l = f[2], n = f[3], m = f[4], p = f[5], r = f[6], q = f[7];
  for (c = 0; 64 > c; c++) 16 > c ? d = b[c] : (d = b[c + 1 & 15], e = b[c + 14 & 15], d = b[c & 15] = (d >>> 7 ^ d >>> 18 ^ d >>> 3 ^ d << 25 ^ d << 14) + (e >>> 17 ^ e >>> 19 ^ e >>> 10 ^ e << 15 ^ e << 13) + b[c & 15] + b[c + 9 & 15] | 0), d = d + q + (m >>> 6 ^ m >>> 11 ^ m >>> 25 ^ m << 26 ^ m << 21 ^ m << 7) + (r ^ m & (p ^ r)) + g[c], q = r, r = p, p = m, m = n + d | 0, n = l, l = k, k = h, h = d + (k & l ^ n & (k ^ l)) + (k >>> 2 ^ k >>> 13 ^ k >>> 22 ^ k << 30 ^ k << 19 ^ k << 10) | 0;
  f[0] = f[0] + h | 0; f[1] = f[1] + k | 0; f[2] = f[2] + l | 0; f[3] = f[3] + n | 0; f[4] = f[4] + m | 0; f[5] = f[5] + p | 0; f[6] = f[6] + r | 0; f[7] = f[7] + q | 0;
  return [f, b, d, e];
}
function wide(f, b, g) {
  var a = f[0], k = f[1], l = f[2], n = f[3], m = f[4], t = 0;
  for (var c = 0; c < 48; c++) { t = (a << 5 ^ a >>> 27) + (k & l ^ k & n ^ l & n) + m + b[c & 7] + g[c + 3 & 31]; m = n; n = l; l = k; k = a; a = t | 0; }
  return [a, k, l, n, m, t];
}
function sums(f, b, g) {
  var a = f[0], k = f[1], l = f[2], n = f[3];
  for (var c = 0; c < 32; c++) { var t = a + (k ^ l ^ n) + (a << 3 ^ a >>> 29 ^ a >>> 2) + b[c & 15]; b[c & 15] = t | 0; n = l; l = k; k = a; a = t; }
  return [a, k, l, n, b];
}
function eighty(f, b, g) {
  var a = f[0], k = f[1], l = f[2], n = f[3], m = f[4], w = g;
  for (var c = 0; c < 80; c++) {
    if (c < 16) w[c] = b[c] | 0; else { var x = w[c - 3] ^ w[c - 8] ^ w[c - 14] ^ w[c - 16]; w[c] = x << 1 | x >>> 31; }
    var t = (a << 5 | a >>> 27) + m + w[c];
    if (c < 20) t += (k & l | ~k & n) + 1518500249; else if (c < 40) t += (k ^ l ^ n) + 1859775393; else if (c < 60) t += (k & l | k & n | l & n) - 1894007588; else t += (k ^ l ^ n) - 899497514;
    m = n; n = l; l = k << 30 | k >>> 2; k = a; a = t;
  }
  return [a, k, l, n, m, w.length];
}
function leaves(f, b, g) {
  var a = f[0] | 0, k = f[1] | 0, l = f[2] | 0, n = f[3] | 0, kept = null;
  try {
    for (var c = 0; c < 64; c++) { var t = (a << 7 ^ a >>> 25 ^ k >>> 3) + (k ^ l & (n ^ k)) + b[c & 15] | 0; if ((t & 63) === 7) { kept = [a, k, l, n, c]; break; } if ((t & 255) === 9) throw new RangeError("at " + a); n = l; l = k; k = a; a = t; }
  } catch (error) { return [error.message, a, k, l, n, c]; }
  return [a, k, l, n, c, kept];
}
function views(f, b, g) {
  var a = f[0] | 0, k = f[1] | 0, l = f[2] | 0, n = f[3] | 0, m = f[4] | 0;
  for (let c = 0; c < 64; c++) { const t = ((a << 26 | a >>> 6) ^ (a << 21 | a >>> 11) ^ (a << 7 | a >>> 25)) + (a & k ^ ~a & l) + m + b[c] + g[c] | 0; m = n; n = l; l = k; k = a; a = t; }
  return [a, k, l, n, m];
}
function show(f) { try { return JSON.stringify(f(), function (key, v) { return Object.is(v, -0) ? "-0" : typeof v === "number" && !(v - v === 0) ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "u" : ArrayBuffer.isView(v) ? Array.from(v) : v; }); } catch (error) { return "threw " + error.name; } }
function at(place, value) { return function () { var a = fill(64, word); a[place] = value; return a; }; }
var kinds = {
  ints: function () { return fill(64, word); }, whole: function () { return fill(64, function (i) { return word(i) >>> 0; }); }, doubles: function () { return fill(64, function (i) { return i * 1.5 - 3; }); }, hole: function () { var a = fill(64, word); delete a[9]; return a; }, late: function () { var a = fill(64, word); delete a[40]; return a; },
  large: at(8, 1099511627776 + 2147483648), larger: at(3, 9007199254740991), huge: at(11, 1e21), minus: at(5, -1099511627779), last: at(15, 4294967296.5), first: at(0, 281474976710657), text: at(3, "7"), nothing: at(2, undefined), none: at(13, null), truth: at(14, true), nan: at(1, NaN), zero: at(7, -0), big: at(6, 1n), infinite: at(10, -Infinity),
  bytes: function () { return new Uint8Array(fill(64, word)); }, view: function () { return new Int32Array(fill(64, word)); }, words: function () { return new Uint32Array(fill(64, word)); }, floats: function () { return new Float64Array(fill(64, word)); }, short: function () { return fill(16, word); }, shorter: function () { return fill(6, word); }, empty: function () { return []; }, frozen: function () { return Object.freeze(fill(64, word)); },
  getter: function () { return Object.defineProperty(fill(64, word), 4, { get: function () { log.push("got"); return 2; }, set: function (v) { log.push(v); }, configurable: true }); }, object: function () { var a = fill(64, word); a[5] = { valueOf: function () { log.push("asked"); return 6; } }; return a; }, subarray: function () { return new Int32Array(fill(80, word)).subarray(5, 69); }, proxy: function () { return new Proxy(fill(64, word), { get: function (a, key) { log.push(String(key)); return a[key]; } }); },
};
var state = function () { return fill(8, function (i) { return word(i + 70); }); };
var functions = { ring: ring, wide: wide, sums: sums, eighty: eighty, leaves: leaves, views: views };
for (var name in functions) {
  for (var p in kinds) {
    var lines = [];
    for (var turn = 0; turn < 4; turn++) {
      lines.push(show(function () { return functions[name](state(), kinds[p](), fill(64, function (i) { return word(i * 3 + turn); })); }), show(function () { return functions[name](state(), fill(16, word), kinds[p]()); }), show(function () { return functions[name](kinds[p](), fill(16, word), fill(64, word)); }));
      lines.push(show(function () { var own = kinds[p](); return functions[name](own, own, own); }), show(function () { var own = kinds[p](); return functions[name](state(), own, own); }), show(function () { var own = kinds[p](); return functions[name](own, own, fill(64, word)); }));
    }
    var h = 0, s = lines.join(" "); for (var i = 0; i < s.length; i++) h = Math.imul(h, 31) + s.charCodeAt(i) | 0;
    console.log(name, p, h, log.length, log.splice(0).join().length, s.length, lines[0].slice(0, 60));
  }
}
