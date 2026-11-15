interface Figure { area(n: number): number }
class Plate implements Figure { constructor(readonly side: number) {} area(n: number) { return this.side * 1000 + n; } }
class Board implements Figure { constructor(readonly wide: number) {} area(n: number) { return this.wide * 1000 + n; } }
var tally = 0;
function probe(figure: Figure) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = figure.area(tally);
  return got + work;
}
const plate = new Plate(2), board = new Board(3);
console.log(probe(plate), probe(board), tally);
Object.defineProperty(Board.prototype, "area", { configurable: true, get() { tally += 5; return function (this: Board, n: number) { return this.wide * 1000 + n; }; } });
console.log(probe(plate), probe(board), tally);
