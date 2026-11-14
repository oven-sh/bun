interface Figure { area(): number }
class Plate implements Figure { constructor(readonly side: number) {} area() { return this.side * this.side; } }
class Board implements Figure { constructor(readonly wide: number, readonly high: number) {} area() { return this.wide * this.high; } }
class Wheel implements Figure { constructor(readonly spoke: number) {} area() { return 3 * this.spoke * this.spoke; } }
function measure(figures: Figure[]) { let sum = 0; for (let turn = 0; turn < 60; turn++) sum += figures[turn % figures.length].area(); return sum; }
const figures: Figure[] = [new Plate(2), new Board(2, 3), new Wheel(1)];
function areaOf(place: number) { return figures[place].area(); }
function deep(figure: Figure, left: number): number { return left ? deep(figure, left - 1) : figure.area(); }
console.log(areaOf(0), areaOf(1), areaOf(2), deep(figures[1], 100000));
