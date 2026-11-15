interface Figure { area(n: number): number }
class Plate implements Figure { constructor(readonly side: number) {} area(n: number) { return this.side * 1000 + n; } }
class Board implements Figure { constructor(readonly wide: number) {} area(n: number) { return this.wide * 1000 + n; } }
class Ghost { constructor(readonly mist: number) {} }
const make = (k: number) => (n: number) => k * 100 + n;
const ghost: any = new Ghost(4);
ghost.area = make(10);
let count = 0;
function swap(): number { count++; ghost.area = make(10 + count); return 1; }
function probe(figure: Figure) { let work = 0; for (let i = 0; i < 3; i++) work = (work + i) | 0; const got = figure.area(swap()); return got + work; }
console.log(probe(new Plate(2)), probe(new Board(3)), probe(ghost), count, process.argv[2] ?? "");
