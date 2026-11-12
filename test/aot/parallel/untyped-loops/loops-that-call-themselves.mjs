// Functions whose loops call them: queens, subsets, permutations, sums that leave 32 bits, texts, throws; 0 to 12 iterations.
// STATISTIC: RecursiveLoopsNotUnrolled >= 1
function queens(m, y, c, a, b) { if (y === m) return 1; let s = 0; for (let x = 0; x < m; x++) { const p = 1 << x, q = 1 << (x + y), d = 1 << (x - y + m); if (c & p || a & q || b & d) continue; s += queens(m, y + 1, c | p, a | q, b | d); } return s; }
function wide(m, y, c) { if (y === m) return c; let s = 0; for (let x = 0; x < m; x++) { if (((x * 7 + c) & 3) === 1) continue; s += wide(m, y + 1, c + x) * 2147483647; if (s > 1e200) break; } return s; }
function text(m, y, c) { if (y === m) return String(c); let s = ""; for (let x = 0; x < 3; x++) { if (x === c % 3) continue; s += text(m, y + 1, c + x); if (s.length > 40) return s.slice(0, 40); } return s; }
function down(m, y, c) { if (y >= m) return c & 7; let s = 0; for (let x = 12; x > 0; x -= 3) { if ((x ^ c) & 1) continue; s = Math.max(s, down(m, y + 1, (c + x) | 0) + x / 2); } return s; }
function caught(m, y, c) { if (y >= m) return 0; let s = 0; for (let x = 0; x < 5; x++) { const v = (x * 13 + y * 7 + c) & 15; if (v < 6) continue; try { s += caught(m, y + 1, v); if (v === 15) throw x; } catch (e) { s += 1000 + e; } } return s; }
function picked(left, from) { if (left <= 0) return left === 0 ? 1 : 0; let n = 0; for (let i = from; i < 12; i++) { if (i > left) continue; n += picked(left - i, i + 1); } return n; }
for (let m = 0; m < 7; m++) console.log(m, queens(m, 0, 0, 0, 0), wide(Math.min(m, 4), 0, 0), text(m, 0, 1), down(m, 0, 1), caught(Math.min(m, 4), 0, 1), picked(m * 3, 1));
