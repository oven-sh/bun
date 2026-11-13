// Reads of which only bits are taken, out of an array of int32s that the loop writes: a hole is zero. A counter that a branch has narrowed stays below the written bound of its loop.
// STATISTIC: TruncatedReadsOfWrittenArrays >= 3
// STATISTIC: ArrayBoundsChecksHoisted >= 3
function rotate(n, count) { return (n << count) | (n >>> (32 - count)); }
const show = a => { let t = a.length + ":"; for (let i = 0; i < a.length; i++) t += i in a ? a[i] + "," : "_,"; return t; };
function schedule(x) { const w = new Array(80); for (let j = 0; j < 80; j++) { if (j < 16) w[j] = x ^ j * 0x9e3779b1; else w[j] = rotate(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1); } return w; }
function gaps(x) { const w = new Array(40); for (let j = 0; j < 40; j++) { if (j < 8) { if (j & 1) w[j] = x + j | 0; } else w[j] = w[j - 1] ^ w[j - 5] ^ w[j - 8]; } return w; }
function shorter(x) { const w = [1, 2, 3, 4]; for (let j = 0; j < 12; j++) { if (j < 4) w[j] ^= x; else w[j] = w[j - 2] ^ w[j - 4]; } return w; }
function outside(x) { const w = new Array(8); for (let j = 0; j < 8; j++) { if (j < 3) w[j] = x + j | 0; else w[j] = w[j + 2] ^ w[j - 3] ^ w[j * 2]; } return w; }
function mixed(x) { const w = new Array(16); for (let round = 0; round < 3; round++) for (let j = 0; j < 16; j++) { w[j] = (w[j] ^ x) + j | 0; w[(j * 5) & 15] = w[(j + 7) & 15] ^ w[15 - j] ^ w[j]; } return w; }
function doubles(x) { const w = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]; for (let j = 0; j < 6; j++) { if (j < 2) w[j] = x | j; else w[j] = w[j - 1] ^ w[j - 2] ^ w[j]; } return w; }
function boxed(x) { const w = [1, "2", undefined, null, true, { valueOf() { return 9; } }]; for (let j = 0; j < 6; j++) { if (j < 2) w[j] = w[j] | x; else w[j] = w[j - 1] ^ w[j - 2] ^ w[j]; } return w; }
function inherited(x) { const w = new Array(8); Object.setPrototypeOf(w, { 3: 1000, 5: 7 }); for (let j = 0; j < 8; j++) { if (j < 2) w[j] = x + j | 0; else w[j - 1] = w[j - 2] ^ w[j] ^ w[j + 1]; } return w; }
function kept(x) { const w = new Array(8), seen = []; for (let j = 0; j < 8; j++) { if (j < 4) w[j * 2] = x + j | 0; else w[j] = w[j - 1] ^ w[j - 3]; seen.push(w[j]); } return seen; }
for (const x of [0, 1, -5, 0x7fffffff, 12345]) {
  console.log(show(schedule(x)), show(gaps(x)), show(shorter(x)));
  console.log(show(outside(x)), show(mixed(x)), show(doubles(x)), show(boxed(x)));
  console.log(show(inherited(x)), kept(x).join());
}
let all = 0;
for (let n = 0; n < 300; n++) { const w = schedule(n), g = gaps(n), m = mixed(n); all = Math.imul(all, 31) + w[n % 80] + g[n % 40] + m[n % 16] | 0; }
console.log(all);
