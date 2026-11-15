// Loops over rows that leave where an element of a row is not there: the element is only tested, or tested and added up.
const any = new Map();
function scale(rows, n, factor) {
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (typeof row[1] !== "number")
            return -1 - i;
        row[0] = row[2] * factor;
    }
    return 1;
}
function copy(rows, to, n) {
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (typeof row[3] !== "number")
            break;
        to[i] = row[0] + row[1];
    }
    return to.length;
}
function sum(rows, n) {
    let total = 0;
    for (let i = 0; i < n; i++) {
        const element = rows[i][1];
        if (typeof element !== "number")
            return -1 - i;
        total += element;
    }
    return total;
}
function raise(rows, n) {
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (row[1] === undefined)
            return -1 - i;
        row[0] += i;
    }
    return 1;
}
function scaleInPlace(rows, n, factor) {
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (row[1] === undefined || row[3] === undefined)
            return -1 - i;
        row[0] *= factor;
    }
    return 1;
}
function addScaled(rows, to, n, factor) {
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (row[1] === undefined)
            break;
        to[i] += row[0] * factor;
    }
    return to.length;
}
const functions = [scale, copy, sum, raise, scaleInPlace, addScaled, (...rest) => rest.length];
function makeRows(n, at, position, makeElement) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < 4; j++)
            row.push(makeElement(i * 4 + j));
        rows.push(row);
    }
    if (at >= 0)
        delete rows[at][position];
    return rows;
}
for (const n of [5, 20]) {
    for (const at of [-1, 0, 3]) {
        for (const makeElement of [index => index * 0.5 + 0.25, index => index]) {
            any.set("rows", makeRows(n, at, 1, makeElement));
            console.log(n, at, functions[0](any.get("rows"), n, 0.5), JSON.stringify(any.get("rows").slice(0, 6)));
            any.set("rows", makeRows(n, at, 1, makeElement));
            console.log(n, at, functions[2](any.get("rows"), n));
            any.set("rows", makeRows(n, at, 1, makeElement));
            console.log(n, at, functions[3](any.get("rows"), n), JSON.stringify(any.get("rows").slice(0, 6)));
            any.set("rows", makeRows(n, at, 3, makeElement));
            console.log(n, at, functions[4](any.get("rows"), n, 0.5), JSON.stringify(any.get("rows").slice(0, 6)));
            any.set("rows", makeRows(n, at, 3, makeElement));
            const to = [];
            for (let i = 0; i < n; i++)
                to.push(0.5);
            any.set("to", to);
            console.log(n, at, functions[1](any.get("rows"), any.get("to"), n), JSON.stringify(to));
            any.set("rows", makeRows(n, at, 1, makeElement));
            console.log(n, at, functions[5](any.get("rows"), any.get("to"), n, 0.5), JSON.stringify(to));
        }
    }
}
