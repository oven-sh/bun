// Loops store sums of 32-bit words under names that classes of another file have, on two paths, and read them off other elements of the list. A check that fails behind the paths undoes both stores.
// STATISTIC: AddressesFoundInIterations >= 4
// STATISTIC: UndoableStoresMergedAtJoins >= 1
import { makers, kinds, show, shown, state } from "./words.mjs";
globalThis.hidden = {
  rounds(W, K, M, H, n) {
    let a = H[0].low, b = H[1].low, c = H[2].high, d = H[3].high;
    for (let i = 0; i < n; i++) {
      const w = W[i];
      let high, low;
      if (i < 4) {
        high = w.high = M[i * 2] | 0;
        low = w.low = M[i * 2 + 1] | 0;
      } else {
        const x = W[i - 3], xh = x.high, xl = x.low;
        const g = ((xh >>> 1) | (xl << 31)) ^ (xh >>> 7), f = ((xl >>> 1) | (xh << 31)) ^ (xl >>> 7);
        const y = W[i - 4], yh = y.high, yl = y.low;
        low = f + yl;
        high = g + yh + ((low >>> 0) < (f >>> 0) ? 1 : 0);
        w.high = high;
        w.low = low;
      }
      const k = K[i & 3], kh = k.high, kl = k.low;
      let t = d + ((a >>> 6) ^ (a << 26));
      t = t + kl;
      t = t + low;
      const u = c + kh + high + ((t >>> 0) < (kl >>> 0) ? 1 : 0);
      d = c;
      c = b;
      b = (a + u) | 0;
      a = t | 0;
    }
    return [a, b, c, d];
  },
  follow(W, n) {
    for (let i = 1; i < n; i++) {
      const w = W[i], o = W[i - 1];
      const s = (o.low ^ i) + o.high;
      if (i & 1) w.high = s + w.high;
      else { w.high = s; o.high = s - 1; }
      w.low = (w.high | 0) + o.low;
    }
  },
};
const order = Object.keys(makers);
for (let warm = 0; warm < 4; warm++) {
  const W = order.slice(0, 1).flatMap(h => Array.from({ length: 12 }, (_, k) => makers[h](k, -k)));
  globalThis.hidden.rounds(W, W, [1, 2, 3, 4, 5, 6, 7, 8], W, 12);
  globalThis.hidden.follow(W, 12);
}
for (let turn = 0; turn < 3; turn++) {
  for (const h of order) {
    for (const a in kinds) {
      state.calls = 0;
      const W = [], K = [], H = [];
      for (let k = 0; k < 12; k++) {
        const isOther = !turn || k === 7;
        W.push(makers[isOther ? h : "created"](isOther ? kinds[a][k & 3] : k * 0x9e3779b1, kinds[turn ? "big" : a][(k + 1) & 3]));
      }
      if (turn === 2) W[10] = W[6];
      for (let k = 0; k < 4; k++) {
        K.push(makers[turn && k === 2 ? h : "created"](kinds[turn && k === 2 ? a : "big"][k], kinds.wide[k]));
        H.push(makers.created(kinds[turn ? "wide" : a][k], kinds.ints[k]));
      }
      let o, p;
      try { o = globalThis.hidden.rounds(W, K, [1, 2, 3, 4, -5, 2 ** 31, 7, 8], H, 12).map(show).join(" "); } catch (e) { o = e.name; }
      try { globalThis.hidden.follow(W, 12); p = "ran"; } catch (e) { p = e.name; }
      let shownWords;
      try { shownWords = W.map(shown).join(" "); } catch (e) { shownWords = e.name; }
      console.log(turn, h, a, o, p, state.calls, shownWords);
    }
  }
}
