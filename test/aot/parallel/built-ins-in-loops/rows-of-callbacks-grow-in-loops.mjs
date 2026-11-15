// Rows that a callback makes with one element, or that are pushed as literals, grow in the loops that fill them.
// STATISTIC: RowStoresMaybeAppending >= 4
function distance(a, b) {
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) rows[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return rows[a.length][b.length];
}
function products(size) {
    const rows = [];
    for (let i = 0; i < size; i++) rows.push([]);
    for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++)
            rows[i][j] = i * j;
    return rows;
}
function halves(size) {
    const rows = new Array(size).fill(0).map(() => []);
    for (let i = 0; i < size; i++)
        for (let j = 0; j < size; j++)
            rows[i][j] = i + j / 2;
    return rows;
}
const words = ["kitten", "sitting", "mitten", "", "a", "intention", "execution"];
const log = [];
for (let turn = 0; turn < 3; turn++)
    for (const a of words) for (const b of words) log.push(distance(a, b));
console.log(log.join());
console.log(products(6).map(row => row.join()).join("|"), halves(5).map(row => row.join()).join("|"));
