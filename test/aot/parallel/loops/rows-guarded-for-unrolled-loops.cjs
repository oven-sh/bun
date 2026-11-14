// The row that all iterations of an unrolled loop read and store into is checked once: rows that are short, sparse, shared, copy-on-write, longer, empty, or that change within the loop.
// STATISTIC: RowsGuardedForUnrolledLoops >= 5
const box = []; for (let i = 0; i < 256; i++) box[i] = i * 167 + 13 & 255;
function grid(k) { const g = [[], [], [], []]; for (let i = 0; i < 16; i++) g[i & 3][i >> 2] = i * 37 + k & 255; return g; }
function looked(s) { for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) s[r][c] = box[s[r][c]]; } return s; }
function added(s, w) { for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) s[r][c] ^= w[c][r]; } return s; }
function moved(s) { const t = [0, 0, 0, 0]; for (let r = 1; r < 4; r++) { for (let c = 0; c < 4; c++) t[c] = s[r][c + r & 3]; for (let c = 0; c < 4; c++) s[r][c] = t[c]; } return s; }
function summed(s) { let sum = 0; for (let r = 0; r < 4; r++) { const row = s[r]; for (let c = 3; c >= 0; c--) { sum = sum + row[c] | 0; row[c] = sum & 255; } } s[0][0] = sum & 15; return s; }
function swapped(s) { for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) { s[r][c] = s[r][c] + 1 & 255; if (c === 1 && r === 2) s[r] = [9, 8, 7, 6]; } } return s; }
function change(s, w, k) {
  if (k === 1) s[2].length = 2;
  if (k === 2) { s[1] = new Array(4); s[1][0] = 5; s[1][3] = 6; }
  if (k === 3) s[3] = s[1];
  if (k === 4) s[0] = [1, 2, 3, 4];
  if (k === 5) s[1][3] = 300;
  if (k === 7) s[0].push(77);
  if (k === 8) s[1] = [];
  if (k === 9) s[3].length = 9;
  if (k === 10) w[2].length = 1;
  if (k === 11) w[1] = s[2];
  if (k === 12) s.length = 3;
}
for (let k = 0; k < 14; k++) {
  for (let form = 0; form < 5; form++) {
    let s = grid(k), w = grid(k + 5), told = "done";
    change(s, w, k);
    try {
      for (let turn = 0; turn < 3; turn++) s = form === 0 ? looked(s) : form === 1 ? added(s, w) : form === 2 ? moved(s) : form === 3 ? summed(s) : swapped(s);
    } catch (e) { told = e.name; }
    for (let r = 0; r < s.length; r++) { told += " |"; for (let c = 0; c < s[r].length; c++) told += c in s[r] ? " " + s[r][c] : " hole"; }
    console.log(k, form, told);
  }
}
