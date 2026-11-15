function* pair(first, second) { yield first; yield second; }
class Mark { constructor(value) { this.value = value; } }
class Holder { constructor() { this.held = undefined; } }
function weigh(holder) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return holder.held === undefined ? work : work + holder.held.value;
}
function rounds() {
    const holder = new Holder();
    let total = 0;
    let last = undefined;
    for (let round = 0; round < 300; round++) {
        for (const value of pair(1, 2)) total += value;
        holder.held = last;
        total += weigh(holder);
        last = new Mark(round);
    }
    return total;
}
console.log(rounds());
