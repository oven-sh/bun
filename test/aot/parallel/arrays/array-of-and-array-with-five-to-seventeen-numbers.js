// Array.of() and Array() of five to seventeen numbers: integers that are computed right in front of the call, fractions, a mixture, in a loop, under try..finally, in coroutines.
const passers = [value => value, value => value + 0];
let passes = 0;
function pass(value) { return passers[passes++ & 1](value); }
function show(list) { return list.length + ":" + list.join() + ":" + list.every(Number.isInteger); }
function integers(turns) {
    const lines = [];
    try {
        for (let turn = 0; turn < turns; turn++) {
            const a = (pass(76) | 0) + 6, b = (pass(77) | 0) + turn, c = (pass(78) | 0) + 1, d = (pass(79) | 0) + 2, e = (pass(80) | 0) + 3;
            lines.push(show(Array.of(a, b, c, d, e)), show(Array(a, b, c, d, e)), show(new Array(a, b, c, d, e)), show(Array.of(a, b, c, d, e, a)), show(Array.of(a, b, c, d)));
            lines.push(show(Array.of(a, b, c, d, e, a, b, c, d, e, a, b, c, d, e, a)), show(Array.of(a, b, c, d, e, a, b, c, d, e, a, b, c, d, e, a, b)));
        }
    } finally {
        lines.push("left");
    }
    return lines.join(" ");
}
function fractions(turns) {
    const lines = [];
    for (let turn = 0; turn < turns; turn++) {
        const a = pass(0.5) + turn, b = pass(1.5) * 2, c = pass(2.25), d = pass(-0), e = pass(NaN);
        lines.push(show(Array.of(a, b, c, d, e)), Object.is(Array.of(a, b, c, d, e)[3], -0), show(Array.of(a, 1, c, 2, e)), show(Array.of(1, b, 2, d, 3, a)));
    }
    return lines.join(" ");
}
function others(turns) {
    const lines = [];
    for (let turn = 0; turn < turns; turn++) {
        const a = (pass(1) | 0) + turn;
        lines.push(Array.of(a, "b", a, undefined, a).join("|"), Array.of(a, a, a, a, pass(turn ? "text" : 5)).join("|"), Array.of(a, a, a, a, 2 ** 31).join("|"), Array.of(a, a, a, a, -(2 ** 31) - 1).join("|"));
    }
    return lines.join(" ");
}
async function later(turns) {
    let sum = 0;
    try {
        for (let turn = 0; turn < turns; turn++) {
            const a = (pass(76) | 0) + 6, b = (pass(77) | 0) + 0, c = (pass(78) | 0) + 1, d = (pass(79) | 0) + 2, e = (pass(80) | 0) + 3;
            for (const value of Array.of(a, b, c, d, e)) sum += value;
            await null;
        }
    } finally {
        sum += 1000;
    }
    return sum;
}
function* stepwise(turns) {
    for (let turn = 0; turn < turns; turn++) {
        const a = (pass(7) | 0) + turn, b = (pass(8) | 0) + 1, c = (pass(9) | 0) + 2, d = (pass(10) | 0) + 3, e = (pass(11) | 0) + 4;
        yield Array.of(a, b, c, d, e);
    }
}
console.log(integers(3));
console.log(fractions(2));
console.log(others(2));
console.log([...stepwise(3)].map(show).join(" "));
later(4).then(sum => console.log(sum));
