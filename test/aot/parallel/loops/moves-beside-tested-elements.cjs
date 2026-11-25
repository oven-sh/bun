// A loop over rows that leaves where an element which it only tests is not there.
const any = new Map();
function run(rows, list, n, factor) {
    let total = 0;
    for (let i = 0; i < n; i++) {
        const row = rows[i];
        if (row[1] === undefined)
            return -1 - i;
        row[0] += i;
    }
    return total;
}
const functions = [run, (...rest) => rest.length];
for (const n of [5, 20]) for (const at of [-1, 0, 3]) for (const kind of [i => i * 0.5 + 0.25, i => i]) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j < 4; j++)
            row.push(kind(i * 4 + j));
        rows.push(row);
    }
    const list = [];
    for (let i = 0; i < n; i++)
        list.push(i * 0.75 - 1);
    if (at >= 0) {
        delete rows[at][1];
        delete list[at + 1];
    }
    any.set("rows", rows);
    any.set("list", list);
    const answer = functions[0](any.get("rows"), any.get("list"), n, 0.5);
    console.log(n, at, answer, JSON.stringify(rows), JSON.stringify(list));
}
