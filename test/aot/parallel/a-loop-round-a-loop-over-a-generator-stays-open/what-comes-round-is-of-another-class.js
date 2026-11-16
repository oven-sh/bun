function* pair(first, second) { yield first; yield second; }
class Small { constructor(value) { this.value = value; } }
class Large { constructor(value) { this.pad = 100; this.value = value; } }
function read(box) {
    let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return box.value + work;
}
function rounds() {
    let total = 0;
    let box = new Small(1);
    for (let round = 0; round < 300; round++) {
        for (const value of pair(1, 2)) total += value;
        total += read(box);
        box = new Large(round);
    }
    return total;
}
console.log(rounds());
