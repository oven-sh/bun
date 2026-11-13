interface Figure { area(n: unknown): number }
const weigh = (n: any): number => (typeof n === "string" ? n.length : typeof n === "function" ? n() : n.n);
class Plate implements Figure { constructor(readonly side: number) {} area(n: unknown) { return this.side * 1000 + weigh(n); } }
class Board implements Figure { constructor(readonly wide: number) {} area(n: unknown) { return this.wide * 1000 + weigh(n); } }
const figures: Figure[] = [new Plate(2), new Board(3)];
function texts() { let sum = 0; for (let i = 0; i < 2; i++) sum += figures[i].area("four"); return sum; }
function objects() { let sum = 0; for (let i = 0; i < 2; i++) sum += figures[i].area({ n: 5 }); return sum; }
function closures() { let sum = 0; for (let i = 0; i < 2; i++) sum += figures[i].area(() => 6); return sum; }
console.log(texts(), objects(), closures());
Board.prototype.area = function (this: Board, n: unknown) { return this.wide * 2000 + weigh(n); };
console.log(texts(), objects(), closures());
