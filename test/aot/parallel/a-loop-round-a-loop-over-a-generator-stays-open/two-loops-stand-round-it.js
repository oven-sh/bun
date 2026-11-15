function* pair(first, second) { yield first; yield second; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return last === undefined ? work : work + last.value;
}
function rounds() {
    let total = 0;
    let outer = undefined;
    for (let row = 0; row < 20; row++) {
        let inner = undefined;
        for (let column = 0; column < 20; column++) {
            for (const value of pair(row, column)) total += value;
            total += weigh(inner) + weigh(outer);
            inner = new Mark(column);
        }
        outer = new Mark(row);
    }
    return total;
}
console.log(rounds());
