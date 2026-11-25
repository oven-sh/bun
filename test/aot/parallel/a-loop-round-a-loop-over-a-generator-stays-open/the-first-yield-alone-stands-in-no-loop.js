function* counts(n) { yield -1; for (let i = 0; i < n; i++) yield i; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return last === undefined ? work : work + last.value;
}
function rounds() {
    let total = 0;
    let last = undefined;
    for (let round = 0; round < 300; round++) {
        for (const value of counts(3)) total += value;
        total += weigh(last);
        last = new Mark(round);
    }
    return total;
}
console.log(rounds());
