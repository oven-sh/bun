// An element that get() hands on through a second get(): the caller computes with it, so a hole is read as NaN.
// STATISTIC: ReturnedHolesReadAsNaN >= 7
const log = [];
class Row {
  constructor(list) { this.list = list; }
  get(i) { return this.list[i]; }
}
class Shifted {
  constructor(row, by) { this.row = row; this.by = by; }
  get(i) { return this.row.get(i + this.by); }
}
class Twice {
  constructor(shifted) { this.shifted = shifted; }
  get(i) { return this.shifted.get(i); }
}
function products(row, n) { let s = 0; for (let i = 0; i < n; i++) s += row.get(i) * 2; return s; }
function differences(row, n) { let s = 0; for (let i = 0; i < n; i++) s -= row.get(i) - 1; return s; }
function bits(row, n) { let s = 0; for (let i = 0; i < n; i++) s = (s + (row.get(i) | 0)) | 0; return s; }
function sums(row, n) { let s = 0; for (let i = 0; i < n; i++) s += row.get(i); return s; }
function kinds(row, n) { const out = []; for (let i = 0; i < n; i++) out.push(typeof row.get(i)); return out.join(); }
function product(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += a.get(i) * b.get(i); return s; }
const plain = value => Object.is(value, -0) ? "-0" : String(value);
const lists = () => [[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5], [1, 2, 3, 4, 5, 6, 7, 8], [0.5, , 2.5, 3.5, , 5.5, 6, 7], [1, , 3, 4, 5, , 7, 8], [0.5, undefined, 2.5, 3, 4, 5, 6, 7], [1, "2", 3, 4, 5, 6, 7, 8], [0.5, 1.5], [], [NaN, -0, 1, 2, 3, 4, 5, 6], [0.5, null, 2, true, 4, 5, 6, 7]];
for (let turn = 0; turn < 4; turn++) {
  for (const list of lists()) {
    const row = new Row(list), shifted = new Shifted(row, 0), behind = new Shifted(row, 1), twice = new Twice(shifted);
    for (const one of [row, shifted, behind, twice]) {
      for (const n of [0, 3, 8]) {
        console.log(plain(products(one, n)), plain(differences(one, n)), bits(one, n), plain(sums(one, n)), kinds(one, n));
        for (const other of [row, behind, twice]) console.log(plain(product(one, other, n)));
      }
    }
  }
}
console.log(log.length);
