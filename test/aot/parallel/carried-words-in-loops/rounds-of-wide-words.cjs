// STATISTIC: BitsOfUnknownValuesChecked >= 8
// Words that are sums of words and never cut enter the rounds as integers of more than 32 bits. Where a word is none, the generic version asks each word once and not every bitwise operator for itself.
globalThis.rounds = {
  sha512(H, W, n) {
    var ah = H[0].high, al = H[0].low, bh = H[1].high, bl = H[1].low, ch = H[2].high, cl = H[2].low, dh = H[3].high, dl = H[3].low;
    for (var i = 0; i < n; i++) {
      var Wi = W[i & 7], g = W[(i + 3) & 7], Wih = g.high, Wil = g.low;
      var s0h = ((Wih >>> 1) | (Wil << 31)) ^ ((Wih >>> 8) | (Wil << 24)) ^ (Wih >>> 7), s0l = ((Wil >>> 1) | (Wih << 31)) ^ ((Wil >>> 8) | (Wih << 24)) ^ ((Wil >>> 7) | (Wih << 25));
      var low = s0l + Wi.low, high = s0h + Wi.high + ((low >>> 0) < (s0l >>> 0) ? 1 : 0);
      Wi.high = high; Wi.low = low;
      var chh = (ah & bh) ^ (~ah & ch), chl = (al & bl) ^ (~al & cl), s1h = ((ah >>> 14) | (al << 18)) ^ ((ah << 23) | (al >>> 9)), s1l = ((al >>> 14) | (ah << 18)) ^ ((al << 23) | (ah >>> 9));
      var tl = dl + s1l, th = dh + s1h + ((tl >>> 0) < (dl >>> 0) ? 1 : 0); tl = tl + chl; th = th + chh + ((tl >>> 0) < (chl >>> 0) ? 1 : 0); tl = tl + low; th = th + high + ((tl >>> 0) < (low >>> 0) ? 1 : 0);
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      al = (tl + dl) | 0; ah = (th + dh + ((al >>> 0) < (tl >>> 0) ? 1 : 0)) | 0;
    }
    H[0].low = H[0].low + al; H[0].high = H[0].high + ah + ((H[0].low >>> 0) < (al >>> 0) ? 1 : 0); H[1].low = H[1].low + bl; H[1].high = H[1].high + bh;
    return [ah, al, bh, bl, ch, cl, dh, dl];
  },
  mix(a, b, c, n) { for (var i = 0; i < n; i++) { var t = ((a & b) ^ (~a & c)) + ((a >>> 3) | (a << 29)); c = b; b = a; a = t; } return [a, b, c]; },
};
let calls = 0;
const counted = v => ({ valueOf() { calls++; return v; } });
const word = (high, low) => ({ high, low });
const values = {
  small: [1, 2, 3, 4, 5, 6, 7, 8], unsigned: [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1], signed: [-1, -2147483648, 2147483647, -5, 7, -9, 11, -13],
  wide: [2 ** 33, -(2 ** 34), 2 ** 40 + 1, 2 ** 48, -(2 ** 48), 2 ** 49, 2 ** 49 - 1, -(2 ** 49)], wider: [2 ** 50, 2 ** 52 + 1, 2 ** 53, -(2 ** 53), 2 ** 53 + 2, 2 ** 60, 1e300, -1e300],
  fractions: [0.5, -0.5, 1e9 + 0.25, -0, 2 ** 40 + 0.5, 3.5, -7.25, 0.1], odd: [NaN, Infinity, -Infinity, -0, 0, NaN, 1, 2], strings: ["1", "2", "0x10", "", "abc", "5", "6", "7"], nullish: [undefined, null, true, false, undefined, 1, 2, 3],
  objects: [counted(5), 2, counted(2.5), 4, 5, counted(2 ** 40), 7, 8], bigints: [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], oneBigint: [1, 2, 3, 4n, 5, 6, 7, 8], symbols: [1, 2, 3, 4, 5, Symbol("s"), 7, 8],
};
const show = v => typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : typeof v === "object" ? "object" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
for (const name in values) for (const other of ["small", "unsigned", name]) for (let turn = 0; turn < 3; turn++) {
  const v = values[name], w = values[other], H = [0, 1, 2, 3].map(k => word(v[2 * k], v[2 * k + 1])), W = [0, 1, 2, 3, 4, 5, 6, 7].map(k => word(w[k], w[(k + 1) & 7])); let said;
  try { const all = []; for (let k = 0; k < turn + 1; k++) all.push(...globalThis.rounds.sha512(H, W, 9 + turn)); said = all.map(show).join(" ") + " | " + H.map(h => show(h.high) + "," + show(h.low)).join(" "); } catch (error) { said = error.name; }
  console.log(name, other, turn, said, calls);
  try { said = globalThis.rounds.mix(v[turn], w[turn + 1], v[turn + 2], 7).map(show).join(" "); } catch (error) { said = error.name; }
  console.log(name, other, turn, said, calls);
}
