// A count that is checked in front of a loop inside would cost the loop around what it knows of its lists, where it reads them behind that loop.
// STATISTIC: CountsOfLoopsAroundKept = 0
const rows = new Uint16Array(20); for (let i = 12; i < 20; i++) rows[i] = 0b1011011101 ^ (i * 3);
function features(h) { let holes = 0, bumps = 0, wells = 0, height = 0; for (let x = 0; x < 10; x++) { height += h[x]; for (let y = 20 - h[x] + 1; y < 20; y++) if (!(rows[y] & (1 << x))) holes++; if (x) bumps += Math.abs(h[x] - h[x - 1]); const left = x ? h[x - 1] : 20, right = x < 9 ? h[x + 1] : 20, depth = Math.min(left, right) - h[x]; if (depth > 0) wells += (depth * (depth + 1)) / 2; } return [height, holes, bumps, wells]; }
function pairs(a, b) { let n = 0, s = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < b.length; j++) if (a[i] > b[j]) n++; s += a[i] * n; } return [n, s]; }
for (const h of [[8, 7, 6, 8, 8, 5, 8, 8, 3, 8], [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, -0, 20, 3, NaN, 1, 2, 3, 4, 5], ["3", 4, null, 5, 6, 7, 1, 2, 3, undefined], [1, 2, 3]]) console.log(features(h).join(), pairs(h, [3, 1, 4, 1, 5]).join(), pairs([2, 7, 1], h).join());
