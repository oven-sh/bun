interface Figure { area(): number }
class Plate implements Figure { constructor(readonly side: number) {} area() { return this.side * this.side; } }
class Board implements Figure { constructor(readonly wide: number, readonly high: number) {} area() { return this.wide * this.high; } }
class Wheel implements Figure { constructor(readonly spoke: number) {} area() { return 3 * this.spoke * this.spoke; } }
function measure(figures: Figure[]) { let sum = 0; for (let turn = 0; turn < 60; turn++) sum += figures[turn % figures.length].area(); return sum; }
const figures: Figure[] = [new Plate(2), new Board(2, 3), new Wheel(1)];
console.log(measure(figures));
Board.prototype.area = function () { return 1000; };
console.log(measure(figures));
