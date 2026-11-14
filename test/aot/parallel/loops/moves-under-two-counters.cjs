// Loops whose elements stand under several counters that are doubles or wide integers, as in the product of two numbers digit by digit, compile and give the answers of the written loop.
const show = value => JSON.stringify(value);
function product(x, y, base) {
  const xc = x.c, yc = y.c; let ycL = yc.length, xcL = xc.length, zc, i, j, k, c, t;
  if (xcL < ycL) { zc = xc; i = xcL; xcL = ycL; ycL = i; }
  for (i = xcL + ycL, zc = []; i--; zc.push(0));
  for (i = ycL; --i >= 0;) { c = 0; for (k = xcL, j = i + k; j > i;) { t = xc[--k] * yc[i] + zc[j] + c; c = t / base | 0; zc[j--] = t % base; } zc[j] = c; }
  return zc;
}
function moved(x, z, i, k) { for (let j = i + k; j > i;) { z[j--] = x[--k]; } return z; }
function digits(xc, yc, i, k) { i = +i; k = +k; let j = i + k; for (; j > i;) { yc[j--] = xc[--k]; } return yc; }
function productOf(xc, yc, base, ycL, xcL) {
  let zc = yc.slice(), c = 0;
  for (let i = +ycL; --i >= 0;) {
    c = 0;
    for (let k = +xcL, j = i + k; j > i;) { const x = xc[--k] * yc[i] + zc[j] + c; c = x / base | 0; zc[j--] = x % base; }
    zc[i] = c;
  }
  return zc;
}
function shifted(xc, from, to, n) { for (let q = n; q > 0; q--) { xc[to] = xc[from]; from -= 1; to -= 1; } return xc; }
function stepped(xc, yc, n, by) { let k = 0; for (let j = n; j >= 0; j--) { yc[j] = xc[k]; k += by; } return yc; }
function dead(a, b, n) { for (let i = 0, k = 0.5; i < n; i++, k++) b[i][0] = a[i][1]; return b; }
function rows(a, b, n, k) { for (let i = n; i > 0; i--) { b[i - 1][k - 1] = a[k - 1][i - 1]; k = k - 0; } return b; }
for (const kind of [i => i + 1, i => i / 2, i => "t" + i, i => ({ i }), i => (i % 3 ? i : undefined)]) {
  const list = n => Array.from({ length: n }, (_, i) => kind(i));
  const grid = () => [list(3), list(3).reverse(), list(3)];
  console.log(show(digits(list(6), list(9), 2, 5)), show(digits(list(6), list(9), 1.5, 3)), show(productOf(list(5), list(8), 10, 3, 4)));
  console.log(show(shifted(list(8), 4, 7, 4)), show(stepped(list(8), list(6), 5, 1)), show(stepped(list(8), list(6), 5, 0.5)));
  console.log(show(dead(grid(), grid(), 3)), show(rows(grid(), grid(), 3, 2)));
}
const n = s => ({ c: Array.from(s, Number) });
console.log(show(product(n("123"), n("45"), 10)), show(product(n("9"), n("88"), 10)));
for (const q of [[[1, 2, 3, 4], [5, 6, 7, 8, 9], 1, 3], [["a", "b", "c"], [], 0, 2], [[1.5, 2.5], [0, 0, 0, 0], 0.5, 2], [[{}, 1], [1, 2], 1, 1]]) console.log(show(moved(...q)), show(moved(q[0], q[1], q[2] * 1.5, q[3] / 2)));
