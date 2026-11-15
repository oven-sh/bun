function* pair(first, second) { yield first; yield second; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return last === undefined ? work : work + last.value;
}
function rounds(count) {
    let total = 0;
    let last = undefined;
    for (let round = 0; round < count; round++) {
        for (const value of pair(1, 2)) total += value;
        total += weigh(last);
        last = new Mark(round);
    }
    return total;
}
function often() {
    let sum = 0;
    for (let time = 0; time < 5; time++) sum += rounds(40 + time);
    return sum;
}
console.log(often());
