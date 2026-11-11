// STATISTIC: InnerLoopsUnrolledWithNest >= 1
"use strict";
const list = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];
function summed(list, rounds) {
    const few = 1, eight = 8;
    let s = 0;
    for (let round = 0; round < rounds; round++) {
        for (let a = 0; a < few; a++) {
            for (let b = 0; b < eight; b++) s += list[b] * 2 + list[b] * 3 + list[b] * 4 + list[b] * 5 + list[b] * 6 + b + a;
            s += a;
        }
    }
    return s;
}
function summedOnceMore(list, rounds) {
    const few = 1, eight = 8;
    let s = 0;
    for (let round = 0; round < rounds; round++) {
        for (let a = 0; a < few; a++) {
            for (let b = 0; b < eight; b++) s += list[b] * 2 + list[b] * 3 + list[b] * 4 + list[b] * 5 + list[b] * 6 + list[b];
            s += a;
        }
    }
    return s;
}
console.log("SAID " + summed(list, 5) + " " + summedOnceMore(list, 5));
