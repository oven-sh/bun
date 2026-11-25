// A loop adds sums of its counters, and numbers that lie boxed, to elements of rows of unknown kinds.
function sums(rows, n) { for (let j = 0; j < 5; j++) { for (let k = 0; k < n; k++) { rows[k][j] += k + j; if (k === 9) rows.length = k; } } return rows; }
function counters(rows, n) { for (let j = 0; j < 4; j++) { for (let k = 0; k < n; k++) { rows[k][j] -= j; rows[k][j + 1] += k; if (k === 9) rows.length = k; } } return rows; }
function numbers(rows, list) { for (let k = 0; k < rows.length; k++) { const x = list[k]; for (let j = 0; j < 4; j++) { rows[k][j] += x; if (k === 9) rows.length = k; } } return rows; }
function later(rows, list) { let x = 1; for (let j = 0; j < 4; j++) { for (let k = 0; k < rows.length; k++) { rows[k][j] = x + rows[k][j]; x = list[k]; } } return rows; }
function numbersAlone(rows, n) { for (let j = 0; j < 5; j++) { for (let k = 0; k < n; k++) { rows[k][j] += k + j; if (k === 9) rows.length = k; } } return String(rows); }
function counterAlone(rows, n) { for (let j = 0; j < 5; j++) { for (let k = 0; k < n; k++) { rows[k][j] -= j; if (k === 9) rows.length = k; } } return String(rows); }
for (const make of [() => [[7], 17, new Array(5).fill(3), [1, 2, 3, 4, 5], [1, 2.5, 3, 4, 5]], () => [new Array(5), [1, 2, 3, 4, 5].concat([6]), [], [5, 4, 3, 2, 1], [5, 4, 3, 2, 1]]]) {
    for (const change of [rows => numbersAlone(rows, 5), rows => counterAlone(rows, 5)]) {
        try { console.log(change(make())); } catch (error) { console.log(error.constructor.name); }
    }
}
const show = row => Array.isArray(row) ? "[" + Array.from(row, x => Object.is(x, -0) ? "-0" : String(x)) + "]" : String(row);
const makes = [
    () => [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], [1, 2, 3, 4, 5].concat([6])],
    () => [[0.5, 1.5, 2.5, 3.5, 4.5], [1, 2.5, 3, 4, 5], [-0, 1, -0, 0.5, 2]],
    () => [[1, "2", 3, null, 5], new Array(5), [1, , 3, , 5]],
    () => [[2147483647, 2147483646, 2147483645, -2147483648, 0], [NaN, 1, Infinity, 2, 3], Object.freeze([1, 2, 3, 4, 5])],
    () => [[7], 17, new Array(5).fill(3)],
    () => [[1n, 2n], [1, 2, 3, 4, 5], []],
];
for (const make of makes) {
    for (const change of [rows => sums(rows, 3), rows => counters(rows, 3), rows => numbers(rows, [1, 0.5, -2]), rows => numbers(rows, ["s", 2147483647, 1.5]), rows => later(rows, [2, 3, 4]), rows => later(rows, [0.25, "t", -0])]) {
        const rows = make();
        let result;
        try { result = change(rows).length; } catch (error) { result = error.constructor.name; }
        console.log(result, rows.map(show).join(" "));
    }
}
