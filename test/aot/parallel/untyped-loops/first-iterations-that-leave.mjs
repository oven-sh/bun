// Counted loops that leave in their first iteration, in a later one, and never: searches, checks of neighbors, moves down, stores and sums before and behind the test that leaves; 0 to 40 elements, lists of every kind, views, texts.
// STATISTIC: UnrolledLoopsPeeled >= 3
function free(cols, row, c) { for (let i = 0; i < row; i++) if (cols[i] === c || Math.abs(cols[i] - c) === row - i) return i; return -1; }
function queens(n, row, cols) { if (row === n) return 1; let s = 0; for (let c = 0; c < n; c++) { let ok = true; for (let i = 0; i < row; i++) if (cols[i] === c || Math.abs(cols[i] - c) === row - i) { ok = false; break; } if (ok) { cols[row] = c; s += queens(n, row + 1, cols); } } return s; }
function moved(l) { for (let i = 1; i < l.length; i++) { const x = l[i]; let j = i - 1; while (j >= 0 && l[j] > x) { l[j + 1] = l[j]; j--; } l[j + 1] = x; } return l; }
function summed(l, x) { let n = 0, c = 0; for (let i = 0; i < l.length; i++) { n += l[i]; if (l[i] === x) break; c++; n += 1000; } return n + "/" + c; }
function stored(l, x, w) { let at = -9; for (let i = 0; i < l.length; i++) { w[i & 7] += i + 1; if (l[i] === x) { at = i; break; } w[(i + 1) & 7] += 100; } return at + ":" + Array.from(w).join(); }
function down(l, x) { let i = l.length - 1; for (; i >= 0; i--) if (l[i] < x) break; return i; }
function same(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return a.length; }
function stepped(l, x, p) { let n = 0; for (let i = p; i < l.length; i += 3) { if (l[i] === x || n > 40) break; n += i; } return n; }
const lists = [[], [3], [3, 1], [1, 3, 2, 7, 7, 0, 5, 9, 4, 6, 8], [0.5, 1.5, 3, 7], [1, , 3], ["a", "b", 3], Int32Array.from([5, 3, 7, 1]), Float64Array.from([0.5, 3, 7]), Array.from({ length: 40 }, (_, i) => (i * 7) % 41)];
for (let turn = 0; turn < 3; turn++) {
  for (const l of lists) {
    const c = l.slice(), w = turn === 1 ? new Int32Array(8) : [0, 0, 0, 0, 0, 0, 0, turn === 2 ? 0.5 : 0];
    console.log(free(l, l.length, 3), summed(l, 3), summed(l, 7), summed(l, 99), stored(l, 3, w), stored(l, 5, w), down(l, 4), same(l, c), same(l, lists[3]), stepped(l, 7, turn), String(moved(c)));
  }
  console.log(queens(4 + turn, 0, []), same("abca", "abcb"), same("āb", "āc"));
}
