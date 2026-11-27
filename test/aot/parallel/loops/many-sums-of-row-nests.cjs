"use strict";
// Nests whose inner loops add up elements of rows for every column, in plain functions, in methods over rows in a field and over a class's own rows.
const nests = {
    meansOfColumns(rows, wide) {
        const means = [];
        for (let column = 0; column < wide; column++) {
            let sum = 0;
            for (let row = 0; row < rows.length; row++)
                sum += rows[row][column];
            means.push(sum / rows.length);
        }
        return means;
    },
    pairsOfRows(rows, wide) {
        const pairs = [];
        for (let first = 0; first < rows.length; first++) {
            const line = [];
            for (let second = 0; second < rows.length; second++) {
                let sum = 0;
                for (let column = 0; column < wide; column++)
                    sum += rows[first][column] * rows[second][column];
                line[second] = sum;
            }
            pairs.push(line);
        }
        return pairs;
    },
    ownWeights(rows, wide, weights) {
        const out = rows.map(() => 0);
        for (let row = 0; row < rows.length; row++) {
            let sum = weights[0];
            for (let column = 0; column < wide; column++)
                sum += rows[row][column] * weights[column + 1];
            out[row] = sum;
        }
        return out;
    },
    runs(rows, wide) {
        for (let row = 1; row < rows.length; row++) {
            let sum = 0;
            for (let column = 0; column < wide; column++) {
                sum += rows[row - 1][column];
                rows[row][column] += sum;
            }
        }
        return rows;
    },
};
class Rows extends Array {
    get wide() {
        return this.length ? this[0].length : 0;
    }

    byColumn(weights) {
        const sums = new Array(this.wide).fill(0);
        for (let column = 0; column < sums.length; column++) {
            let sum = 0;
            for (let row = 0; row < this.length; row++)
                sum += this[row][column] * weights[row];
            sums[column] = sum;
        }
        return sums;
    }

    byRow(weights) {
        const sums = new Array(this.length).fill(0);
        for (let row = 0; row < this.length; row++) {
            let sum = 0;
            for (let column = 0; column < this.wide; column++)
                sum += this[row][column] * weights[column];
            sums[row] = sum;
        }
        return sums;
    }
}
const lines = (many, long, of) => Array.from({ length: many }, (_, row) => Array.from({ length: long }, (__, column) => of(row, column)));
const given = {
    fractions: () => lines(9, 12, (row, column) => row / 3 - column * 0.75),
    whole: () => lines(9, 12, (row, column) => ((row + 2) * (column + 3)) % 10),
    mixed: () => lines(7, 10, (row, column) => (row % 2 ? column : column + 0.25)),
    few: () => lines(2, 3, (row, column) => row - column / 2),
    views: () => lines(5, 10, (row, column) => row * column / 2).map(row => Float64Array.from(row)),
    holes: () => lines(4, 6, (row, column) => row + column).map((row, at) => { if (at === 1) delete row[2]; return row; }),
    texts: () => lines(3, 5, (row, column) => (row === 2 && column === 4 ? "t" : 1)),
    nothing: () => lines(3, 5, (row, column) => (column === 1 ? null : column)),
};
const said = value => (Array.isArray(value) || ArrayBuffer.isView(value) ? "[" + Array.from(value, said).join(" ") + "]" : typeof value === "number" ? value.toPrecision(8) : typeof value + value);
const weights = Array.from({ length: 14 }, (_, at) => 1 / (at + 1));
for (let round = 0; round < 2; round++) {
    for (const [name, make] of Object.entries(given)) {
        const wide = make()[0].length;
        for (const [nest, run] of Object.entries(nests)) {
            let line;
            try {
                line = said(run(make(), wide, weights));
            } catch (error) {
                line = error.constructor.name;
            }
            console.log(name, nest, line.length, line.slice(0, 300));
        }
        const rows = Rows.from(make());
        let line;
        try {
            line = said(Array.from(rows.byColumn(weights))) + said(Array.from(rows.byRow(weights)));
        } catch (error) {
            line = error.constructor.name;
        }
        console.log(name, rows instanceof Rows, line.slice(0, 400));
    }
}
