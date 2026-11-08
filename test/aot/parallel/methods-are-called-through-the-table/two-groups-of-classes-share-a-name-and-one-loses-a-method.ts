// STATISTIC: MethodCallsThroughTable >= 2
interface Figure { area(): number }
class Plate implements Figure { constructor(readonly side: number) {} area() { return this.side * this.side; } }
class Board implements Figure { constructor(readonly wide: number, readonly high: number) {} area() { return this.wide * this.high; } }
interface Land { area(): number }
class Meadow implements Land { constructor(readonly acres: number) {} area() { return this.acres * 4047; } }
class Marsh implements Land { constructor(readonly acres: number) {} area() { return this.acres * 4000; } }
function ofFigures(figures: Figure[]) { let sum = 0; for (let turn = 0; turn < 40; turn++) sum += figures[turn & 1].area(); return sum; }
function ofLands(lands: Land[]) { let sum = 0; for (let turn = 0; turn < 40; turn++) sum += lands[turn & 1].area(); return sum; }
const figures: Figure[] = [new Plate(2), new Board(2, 3)];
const lands: Land[] = [new Meadow(1), new Marsh(2)];
console.log(ofFigures(figures), ofLands(lands));
Marsh.prototype.area = function () { return 1; };
console.log(ofFigures(figures), ofLands(lands));
