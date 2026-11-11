exports.tintOf = function (one) { return one.tint; };
exports.hasTint = function (one) { return one.tint ? 1 : 0; };
exports.rowsBelow = (0, eval)(`(function (count, above) { const all = []; for (let i = 0; i < count; i++) { const one = Object.create(above); for (let k = 0; k < (i >> 1) + 1; k++) one["p" + k] = k + 1; if (i & 1) one.tint = i * 3 + 1; all.push(one); } return all; })`);
exports.drive = function (read, expected, all, changes) {
    const turns = Number(process.argv[2] ?? 120000);
    let sum = 0, wrong = 0, next = 0, watched = 0;
    for (let turn = 0; turn < turns; turn++) {
        while (next < changes.length && turn >= Math.floor(turns * changes[next][0])) { changes[next++][1](all); watched = 4 * all.length; }
        const one = all[turn % all.length], got = read(one);
        sum = (sum * 3 + (typeof got === "number" ? got : got === undefined ? 5 : String(got).length + 11)) % 1000003;
        if ((watched > 0 || turn % 499 === 0) && !Object.is(expected(one), got)) wrong++;
        if (watched > 0) watched--;
    }
    console.log("SAID", sum, wrong);
};
