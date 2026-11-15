// A row grows by one element in each iteration of the outer loop, and the inner loop adds to that element: its length is asked against the key, not against the greatest key.
// STATISTIC: InvariantKeyBoundsChecks >= 3
function product(x, y) {
    const z = [];
    for (let i = 0; i < 4; i++) {
        z[i] = [];
        for (let j = 0; j < 4; j++) {
            z[i][j] = 0;
            for (let k = 0; k < 4; k++)
                z[i][j] += x[i][k] * y[k][j];
        }
    }
    return z;
}
// Rows as long as their number.
function triangle(rows) {
    let sum = 0;
    for (let i = 0; i < 5; i++)
        for (let j = 0; j <= i; j++)
            for (let k = 0; k < 3; k++)
                sum += rows[i][j] * k;
    return sum;
}
// The key is past the end of some rows.
function missing(rows) {
    let found = 0;
    for (let j = 0; j < 5; j++)
        for (let k = 0; k < 5; k++)
            found += rows[k][j] === undefined ? 100 : rows[k][j];
    return found;
}
// The inner loop shortens, lengthens and empties what it reads.
function changed(rows, turn) {
    const log = [];
    for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
            log.push(rows[0][j]);
            if (turn === 2 && k === 2) rows[0].length = j;
            if (turn === 3 && k === 1) rows[0] = [j, k, , 9];
            if (turn === 4 && k === 0) rows[0].push(j * 10);
            rows[0][j] = (rows[0][j] ?? -1) + k;
        }
    }
    return log.join() + "/" + rows[0].join();
}
const integers = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i + j));
const doubles = integers.map(row => row.map(value => value / 2 + 0.25));
const mixed = [[1, 2.5, "3", 4], [null, 1, 2, 3], [undefined, {}, 1, 2], [1, 2, 3, NaN]];
const jagged = Array.from({ length: 5 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => i * 10 + j));
for (let turn = 0; turn < 60; turn++) {
    const a = product(integers, integers), b = product(doubles, integers), c = product(mixed, integers), d = product(integers, doubles);
    const line = [a, b, c, d].map(z => z.map(row => row.join()).join(";")).join(" | ") + " " + triangle(jagged) + " " + missing(jagged);
    if (turn % 20 === 0) console.log(line);
}
for (let turn = 0; turn < 6; turn++) console.log(changed([[1, 2, 3, 4], [5]], turn), changed([[1.5, 2.5, 3.5, 4.5], [5]], turn), changed([["a", "b", "c", "d"]], turn));
