// STATISTIC: Int32OrUint32GuardsHoisted >= 40
// Words of unknown type enter the loop, and bitwise operators make what comes round. A check of them before the loop asks for integers, also where a sum stands between.
const outside = JSON.parse("{}");
outside.rounds = {
  eight(H, K) {
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (var i = 0; i < 64; i++) {
      var ch = (e & f) ^ (~e & g);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t1 = h + ch + K[i];
      h = g; g = f; f = e;
      e = (d + t1) | 0;
      d = c; c = b; b = a;
      a = (t1 + maj) | 0;
    }
    return [a, b, c, d, e, f, g, h].join(" ");
  },
  four(H, n) {
    var a = H[0], b = H[1], c = H[2], d = H[3];
    for (var i = 0; i < n; i++) { var m = a & b; var t = d + i; d = c; c = b; b = (a + t) >>> 0; a = (t + m) | 0; }
    return [typeof a, a, b, c, d].join(" ");
  },
};
const K = []; for (let i = 0; i < 64; i++) K[i] = (i * 0x9e3779b1) | 0;
let calls = 0;
const counted = v => ({ valueOf() { calls++; return v; } });
const words = {
  integers: [1, 2, 3, 4, 5, 6, 7, 8], unsigned: [1, 2, 3, 4, 5, 6, 7, 8].map(v => (v * 0x6a09e667) >>> 0), signed: [1, 2, 3, 4, 5, 6, 7, 8].map(v => (v * 0x6a09e667) | 0),
  fractions: [0.5, 1.5, 2.5, -3.5, 4.25, 5.75, 6.5, -0], wide: [2 ** 31, 2 ** 32, 2 ** 53, -(2 ** 31), 2 ** 53 + 2, 1e300, 2 ** 31 - 1, -1], NaNs: [NaN, Infinity, -Infinity, NaN, 1, 2, 3, NaN],
  strings: ["1", "2", "3", "4", "5", "6", "7", "8"], text: ["a", 2, 3, 4, 5, 6, 7, "h"], undefineds: [1, 2, 3], nullish: [null, undefined, true, false, null, undefined, true, false], holes: [1, , 3, , 5, , 7, 8],
  objects: [counted(1), 2, 3, counted(4), counted(5), 6, 7, counted(8)], bigints: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], oneBigint: [1, 2, 3, 4, 5, 6, 7, 8n], symbol: [1, 2, 3, 4, Symbol("e"), 6, 7, 8],
};
for (let turn = 0; turn < 3; turn++) {
  for (const name in words) {
    for (const run of [() => outside.rounds.eight(words[name], K), () => outside.rounds.four(words[name], turn + 2)]) {
      try { console.log(name, run(), calls); } catch (error) { console.log(name, error.name, calls); }
    }
  }
}
