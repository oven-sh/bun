interface Figure { area(n: number): number }
class Plate implements Figure { constructor(readonly side: number) {} area(n: number) { return this.side * 1000 + n; } }
class Board implements Figure { constructor(readonly wide: number) {} area(n: number) { return this.wide * 1000 + n; } }
class Ghost implements Figure { constructor(readonly mist: number) {} get area() { tally += 5; const mist = this.mist; return (n: number) => mist * 1000 + n; } }
var tally = 0;
function probe(figure: Figure) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const got = figure.area(tally);
  return got + work;
}
console.log(probe(new Plate(2)), probe(new Board(3)), probe(new Ghost(4)), tally);
