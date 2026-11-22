function* pair(first, second) { yield first; yield second; }
class Mark { constructor(value) { this.value = value; } }
function weigh(last) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return last === undefined ? work : work + last.value;
}
function rounds(limit) {
    let total = 0;
    let last = undefined;
    search: for (let round = 0; ; round++) {
        try {
            for (const value of pair(round, 2)) {
                if (value > limit) break search;
                if (value === 7) continue search;
                total += value;
            }
        } finally {
            total += weigh(last);
        }
        last = new Mark(round);
    }
    return total + weigh(last);
}
console.log(rounds(50), rounds(3), rounds(0));
