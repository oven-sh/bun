// Counts of loops inside loops, below and above the int32s, and near where doubles round.
// STATISTIC: CountsOfLoopsAroundKept >= 12
function holes(rows, starts) { let holes = 0; for (let x = 0; x < starts.length; x++) for (let y = 20 - starts[x] + 1; y < 20; y++) if (!(rows[y] & (1 << x))) holes++; return holes; }
function pairs(list) { let n = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (list[i] < list[j]) n++; return n; }
function steps(list, n) { for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) if (list[j] & 1) n += 2; else n++; return n; }
function letters(words) { let n = 0; for (let i = 0; i < words.length; i++) for (let j = 0; j < words[i].length; j++) if (words[i].charCodeAt(j) > 100) n++; return n; }
function down(list) { let n = 0; for (let i = list.length - 1; i >= 0; i--) for (let j = i; j >= 0; j--) { if (list[j] === 3) n++; if (n > 70) break; } return n; }
function inner(view) { let n = 0; for (let i = 0; i < view.length; i++) { let k = 0; for (let j = 0; j < view.length; j++) if (view[j] > i) { k++; n++; } if (k > 5) n += k; } return n; }
function both(list) { let a = 0, b = 0; for (let i = 0; i < list.length; i++) { for (let j = 0; j < list.length; j++) if (list[j] > 2) a++; else b++; a += b & 1; } return [a, b]; }
function told(list, tell) { let n = 0; for (let i = 0; i < list.length; i++) { for (let j = 0; j < list.length; j++) if (list[j] > 2) n++; tell(n); } return n; }
const rows = new Uint16Array(20); for (let i = 12; i < 20; i++) rows[i] = 0b1011011101 ^ (i * 3);
const ints = Array.from({ length: 30 }, (_, i) => i * 7 % 11), doubles = ints.map(x => x / 2), mixed = ints.map((x, i) => i % 5 ? x : "s" + x), holed = [1, , 3, , 5, 3];
for (let turn = 0; turn < 3; turn++) {
  console.log(holes(rows, [8, 7, 6, 8, 8, 5, 8, 8, 3, 8]), holes(rows, [0, 21, -4, 2.5]), holes([1, 2], [8, 30]));
  for (const list of [ints, doubles, mixed, holed, [], new Float64Array(ints), new Uint8Array(ints)]) console.log(pairs(list), down(list), inner(list), ...both(list), told(list, n => { if (n === 7) list.x = n; }));
  for (const n of [0, 2147483640, 4294967290, 2 ** 52 - 3, 2 ** 53 - 70, 2 ** 53, 0.5, -5, NaN, "t"]) console.log(steps(ints, n), steps(holed, n));
  console.log(letters(["abc", "xyz", "", "hello"]));
}
