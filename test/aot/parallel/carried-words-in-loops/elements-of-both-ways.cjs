// STATISTIC: StoredElementsMergedAtJoins >= 6
// What both ways of an iteration have stored under one key is what a read behind them finds, unless a list is aliased, frozen, cut, full of holes, of another kind, or the key is another
"use strict";
const fill = (n, f) => { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; };
const programs = {
  rounds(W, M, H, n) {
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
    for (var i = 0; i < n; i++) {
      if (i < 16) W[i] = M[i] | 0; else { var x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = x << 1 | x >>> 31; }
      var t = (a << 5 | a >>> 27) + e + W[i];
      if (i < 20) t += (b & c | ~b & d) + 0x5a827999; else if (i < 40) t += (b ^ c ^ d) + 0x6ed9eba1; else t += (b & c | b & d | c & d) - 0x70e44324;
      e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t;
    }
    return [a, b, c, d, e];
  },
  numbers(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i & 1) W[i] = M[i & 7] * 0.5; else W[i] = i; s = s + W[i]; } return [s]; },
  zeros(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i & 1) W[i] = -0; else W[i] = 0; s += 1 / W[i] < 0 ? 1 : 1000; } return [s]; },
  nested(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i < 4) W[i] = i; else if (i < 9) W[i] = s ^ i; else if (i & 1) W[i] = M[i & 7]; else W[i] = -i; s = s + W[i] | 0; } return [s]; },
  aliased(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i & 1) { W[i] = i * 3; M[i] = s; } else W[i] = s ^ 5; s = s + W[i] | 0; } return [s]; },
  behind(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i & 1) W[i] = i * 3; else W[i] = s ^ 5; M[i & 3] = 77; s = s + W[i] | 0; } return [s]; },
  key(W, M, H, n) { var s = 0, k = 0; for (var i = 0; i < n; i++) { if (i & 1) { W[k] = i; k = k + 1 & 7; } else W[k] = -i; s = s + W[k] | 0; } return [s, k]; },
  one(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i % 3) W[i] = s ^ i; s = s + (W[i] | 0) | 0; } return [s]; },
  mixed(W, M, H, n) { var s = ""; for (var i = 0; i < n; i++) { if (i & 1) W[i] = i; else W[i] = "t" + i; s += W[i]; } return [s]; },
  cut(W, M, H, n) { var s = 0; for (var i = 0; i < n; i++) { if (i & 1) W[i] = i; else W[i] = i * 2; if (i === 5) W.length = 2; s = s + (W[i] === undefined ? 100 : W[i]); } return [s]; },
  other(W, M, H, n) { var s = 0, L = W; for (var i = 0; i < n; i++) { if (i & 1) L[i] = i; else { L = i & 2 ? M : W; L[i] = s ^ 3; } s = s + L[i] | 0; } return [s]; },
};
const lists = {
  ints: () => fill(24, i => i), doubles: () => fill(24, i => i + 0.5), boxed: () => { const a = fill(24, i => i); a[3] = "three"; return a; }, holes: () => { const a = fill(24, i => i); delete a[6]; return a; }, empty: () => [], short: () => fill(5, i => -i),
  wide: () => fill(24, i => 2 ** 40 + i), bytes: () => new Uint8Array(24), clamped: () => new Uint8ClampedArray(24), words: () => new Uint32Array(24), shorts: () => new Int16Array(7), floats: () => new Float32Array(24), frozen: () => Object.freeze(fill(24, i => i)),
  accessor: () => { const a = fill(24, i => i); Object.defineProperty(a, 4, { get() { return 44; }, set(v) { }, configurable: true }); return a; }, record: () => ({ 0: 1, length: 1 }), proxy: () => new Proxy(fill(24, i => i), { get(t, k) { return k === "7" ? 70 : t[k]; } }),
};
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) || ArrayBuffer.isView(v) ? "[" + Array.from(v, show).join() + "]" : typeof v === "object" ? "o" : String(v);
for (const name in programs) for (const kind in lists) for (let round = 0; round < 3; round++) {
  const W = lists[kind](), M = round === 1 ? W : lists[round ? "ints" : "doubles"](); let said;
  try { for (let turn = 0; turn < 3; turn++) said = programs[name](W, M, [1, 2 + turn, 3, round === 2 ? 2 ** 33 : 4, round ? 5 : 0.5], 24 - round).map(show).join(" "); } catch (error) { said = error.name; }
  console.log(name, kind, round, said, show(W));
}
