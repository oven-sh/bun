// Lists that hold doubles, int32s, or go from one to the other between loops and in their middle: one bit tells the two.
// STATISTIC: NumericArraysTestedByOneBit >= 1
function sum(list, n) { let s = 0; for (let i = 0; i < n; i++) s += list[i]; return s; }
function product(a, b, n) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
function greatest(list, n) { let g = -Infinity; for (let i = 0; i < n; i++) if (list[i] > g) g = list[i]; return g; }
function truths(list, n) { let t = 0; for (let i = 0; i < n; i++) if (list[i]) t++; return t; }
function mixed(list, n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 3) list[0] = 0.5; s += list[i % list.length]; } return s; }
function rows(table) { let s = 0; for (let r = 0; r < table.length; r++) for (let c = 0; c < table[r].length; c++) s += table[r][c]; return s; }
function at(list, i) { return list[i] + 1; }
const lists = () => [[1, 2, 3, 4, 5, 6, 7, 8, 9], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], [1, 2, 3, 4.5, 5, 6, 7, 8, 9], [0, -0, 1, 0, 2, 0, 3, NaN, 4], [2147483647, 1, 2147483647, 5, -2147483648, 7, 8, 9, 1], [7], [], [0.25], [1, , 3, 4, 5, 6, , 8, 9], [0.5, , 1.5, , 2.5, 3, 4, 5, 6], [1, 2, 'x', 4, 5, 6, 7, 8, 9]];
const plain = value => Object.is(value, -0) ? '-0' : String(value);
for (let turn = 0; turn < 4; turn++) {
    for (const list of lists()) {
        console.log(plain(sum(list, list.length)), plain(greatest(list, list.length)), truths(list, list.length), plain(at(list, 2)));
        for (const other of lists())
            console.log(plain(product(list, other, 9)), plain(rows([list, other])));
        console.log(plain(mixed(list, 7)), plain(sum(list, 9)));
        list[1] = 1.25;
        console.log(plain(sum(list, 9)), plain(product(list, list, list.length)));
    }
}
