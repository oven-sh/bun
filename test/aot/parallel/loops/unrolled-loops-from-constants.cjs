// A counter that a constant enters, held against bounds at the edges of int32s: no bound wraps in front of the iterations.
// STATISTIC: UnrolledLoopsFromConstants >= 1
function sum(a, n) { let s = 0; for (let i = 0; i < n; i++) s += a[i]; return s; }
function product(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function sumTo(a, n) { let s = 0; for (let i = 0; i <= n; i++) s += a[i]; return s; }
function fromAbove(a, n) { let s = 0; for (let i = 6; i > n; i--) s += a[i]; return s; }
function fromBelow(n) { let s = 0; for (let i = -2147483648; i < n; i += 3) s += i; return s; }
function nearTheEnd(n) { let s = 0; for (let i = 2147483640; i <= n; i++) s += i & 7; return s; }
function tested(a, n) { let s = 0, i = 0; do { s += a[i]; i++; } while (i < n); return s; }
function nest(rows, n) { let s = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r]; for (let k = 0; k < n; k++) s += row[k]; } return s; }
const doubles = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], whole = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], mixed = [1, 2.5, 3, , 4.5, 'x'], short = [7];
const plain = value => Object.is(value, -0) ? '-0' : String(value);
for (let turn = 0; turn < 3; turn++) {
    for (const n of [0, 1, 2, 7, 8, 9, 10, 12, -1, -2147483648, -2147483647, -2147483642, -2147483641, 2.5, NaN, -Infinity, '8', null]) {
        console.log(plain(n), [doubles, whole, mixed, short].map(list => plain(sum(list, n)) + ' ' + plain(sumTo(list, n)) + ' ' + plain(tested(list, n))).join(' | '));
        console.log(plain(product(doubles, whole, n)), plain(product(whole, mixed, n)), plain(nest([doubles, whole, mixed, short], n)));
    }
    for (const n of [6, 5, 0, -1, 2147483647, 5.5])
        console.log(plain(fromAbove(doubles, n)), plain(fromAbove(whole, n)), plain(fromAbove(short, n)));
    for (const n of [-2147483648, -2147483647, -2147483640, -2147483600, -2147483641.5])
        console.log(plain(fromBelow(n)));
    for (const n of [2147483639, 2147483640, 2147483646, 2147483647])
        console.log(plain(nearTheEnd(n)));
}
