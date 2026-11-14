// STATISTIC: ArraysOfMixedSumsHoldDoubles >= 1
// A schedule of words stores sums of mixed words that nothing truncates: one in four is no int32. The version of the loop holds doubles from the start.
const schedules = globalThis.schedules = {
  expand(W, M, offset, n) {
    var a = 1, b = 2, c = 3, d = 4;
    for (var i = 0; i < n; i++) {
      if (i < 16) { W[i] = M[offset + i] | 0; } else {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x << 25) | (x >>> 7)) ^ ((x << 14) | (x >>> 18)) ^ (x >>> 3), s1 = ((y << 15) | (y >>> 17)) ^ ((y << 13) | (y >>> 19)) ^ (y >>> 10);
        W[i] = s0 + W[i - 7] + s1 + W[i - 16];
      }
      var t = d + (((a << 26) | (a >>> 6)) ^ ((a << 21) | (a >>> 11))) + ((a & b) ^ (~a & c)) + W[i];
      d = c; c = b; b = a; a = t | 0;
    }
    return [a, b, c, d];
  },
  difference(W, n) { for (var i = 2; i < n; i++) W[i] = (W[i - 1] ^ (W[i - 2] << 7)) - ((W[i - 2] >>> 5) ^ ~W[i - 1]); return W.length; },
  small(W, n) { for (var i = 2; i < n; i++) W[i] = (W[i - 1] & 255) + (W[i - 2] & 255); return W.length; },
};
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "object" : String(v);
let calls = 0; const counted = v => ({ valueOf() { calls++; return v; } });
const words = n => { const list = []; for (let i = 0; i < n; i++) list[i] = (i * 0x9e3779b1) | 0; return list; };
const lists = {
  empty: () => [], int32s: () => words(64), doubles: () => words(64).map(v => v + 0.5), wide: () => words(64).map(v => v * 4096), zeros: () => new Array(64).fill(0), holes: () => new Array(64), short: () => words(10), strings: () => words(64).map(String), mixed: () => { const w = words(64); w[20] = "x"; w[40] = undefined; return w; },
  negative: () => { const w = words(64); w[17] = -0; w[18] = NaN; w[19] = 2 ** 53; return w; }, objects: () => { const w = words(64); w[21] = counted(7); return w; }, bigints: () => { const w = words(64); w[30] = 5n; return w; },
  bytes: () => new Uint8Array(64), ints: () => new Int32Array(64), floats: () => new Float64Array(64), frozen: () => Object.freeze(words(64)), sealed: () => Object.seal(words(64)), record: () => ({ length: 0 }), accessor: () => { const w = words(64); Object.defineProperty(w, 33, { get() { calls++; return 9; }, set(v) { calls += 10; }, configurable: true }); return w; },
  below: () => { const w = words(16); Object.setPrototypeOf(w, { __proto__: Array.prototype, get 40() { calls++; return 3; } }); return w; }, proxy: () => new Proxy(words(64), {}),
};
const kept = []; // one array that every turn uses again
for (let turn = 0; turn < 60; turn++) schedules.expand(kept, words(32), turn & 7, 64);
console.log(kept.map(show).join(" "));
for (const name in lists) for (const source of ["int32s", "doubles", "holes", "strings", "short"]) for (let turn = 0; turn < 2; turn++) {
  const W = lists[name](), M = lists[source](); let said;
  try { said = schedules.expand(W, M, turn, 40).map(show).join(); } catch (error) { said = error.name; }
  console.log(name, source, turn, said, show(W[16]), show(W[17]), show(W[20]), show(W[33]), show(W[39]), W.length, calls);
}
for (const name in lists) for (const which of ["difference", "small"]) { const W = lists[name](); let said; try { said = schedules[which](W, 30); } catch (error) { said = error.name; } console.log(name, which, show(said), [0, 2, 5, 11, 20, 29].map(k => { try { return show(W[k]); } catch (error) { return error.name; } }).join(" "), calls); }
