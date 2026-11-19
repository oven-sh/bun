// Nests of loops of a constant number of iterations that store into the rows of a grid: rows that are short, the same array twice, shared with the other grid.
// STATISTIC: StoringLoopsUnrolledInVersions >= 3
function grid(k) { var g = [[], [], [], []]; for (var i = 0; i < 16; i++) g[i % 4][Math.floor(i / 4)] = (i * 37 + k) & 255; return g; }
var box = []; for (var i = 0; i < 256; i++) box[i] = (i * 167 + 13) & 255;
function looked(s, n) { for (var r = 0; r < 4; r++) { for (var c = 0; c < n; c++) s[r][c] = box[s[r][c]]; } return s; }
function moved(s, n) { var t = new Array(4); for (var r = 1; r < 4; r++) { for (var c = 0; c < 4; c++) t[c] = s[r][(c + r) % n]; for (var c = 0; c < 4; c++) s[r][c] = t[c]; } return s; }
function added(s, w, k, n) { for (var r = 0; r < 4; r++) { for (var c = 0; c < n; c++) s[r][c] ^= w[k * 4 + c][r]; } return s; }
function round(s, w, k) { s = looked(s, 4); s = moved(s, 4); return added(s, w, k, 4); }
for (let k = 0; k < 9; k++) {
  let s = grid(k), w = grid(k + 1).concat(grid(k + 2));
  if (k === 4) s[3].length = 2;
  if (k === 5) w[6] = s[2];
  if (k === 6) s[1] = s[2];
  if (k === 7) w[5].length = 1;
  try { for (let turn = 0; turn < 5; turn++) s = round(s, w, turn & 1); } catch (e) { console.log(e.name); }
  let told = ""; for (var r = 0; r < 4; r++) { for (var c = 0; c < s[r].length; c++) told += (c in s[r] ? s[r][c] : "hole") + " "; told += "| "; } console.log(k, told);
}
