interface Figure { area(n: unknown): number }
class Plate implements Figure { constructor(readonly side: number) {} area(n: any) { return this.side * 1000 + (typeof n === "number" ? n : typeof n === "function" ? n() : n.n); } }
class Board implements Figure { constructor(readonly wide: number) {} area(n: any) { return this.wide * 1000 + (typeof n === "number" ? n : typeof n === "function" ? n() : n.n); } }
class Ghost implements Figure { constructor(readonly mist: number) {} get area() { bump(); const mist = this.mist; return (n: any) => mist * 1000 + (typeof n === "number" ? n : typeof n === "function" ? n() : n.n); } }

let bump = () => {};
function outer() {
  let tally = 0;
  bump = () => { tally += 5; };
  function probe(figure: Figure) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const got = figure.area(tally); return got + work; }
  return [probe(new Plate(2)), probe(new Board(3)), probe(new Ghost(4)), tally].join(" ");
}
console.log(outer());
