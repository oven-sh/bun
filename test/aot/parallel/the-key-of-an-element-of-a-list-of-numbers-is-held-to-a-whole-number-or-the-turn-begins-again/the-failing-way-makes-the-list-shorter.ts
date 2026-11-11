// STATISTIC: NumberKeysGuardedInIterations >= 1
const STEPS = [-33, -31, -18, -14, 0, 14, 18, 31, 33];
const rounds = +process.argv[2]! || 3;
class Field {
  cells: number[] = [];
  constructor(n: number) { for (let i = 0; i < n; i++) this.cells.push(i % 7); }
  probe(square: number, want: number): number {
    let seen = 0, place = 1;
    for (const step of STEPS) {
      const from = square + step;
      if (!(from & 0x88) && this.cells[from] === want) seen += place;
      place *= 2;
    }
    return seen * 1000 + this.cells.length;
  }
}
for (let r = 0; r < rounds; r++) {
  const f = new Field(60);
  console.log("before", f.probe(52, 3), f.probe(52, 5), f.probe(33, 5), f.probe(52.5, 5));
  const cuts: any = Object.create(Array.prototype);
  Object.defineProperty(cuts, 66, { configurable: true, get() { f.cells.length = 20; return 5; } });
  Object.setPrototypeOf(f.cells, cuts);
  console.log("cut", f.probe(52, 5), f.probe(52, 5), f.probe(33, 5), f.probe(19, 5));
  const g = new Field(60), other = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5];
  const swaps: any = Object.create(Array.prototype);
  Object.defineProperty(swaps, 66, { configurable: true, get() { g.cells = other; return 5; } });
  Object.setPrototypeOf(g.cells, swaps);
  console.log("replaced", g.probe(52, 5), g.probe(52, 5), g.probe(1, 15.5), g.probe(19, 5.5));
  const h = new Field(128);
  (h.cells as any)["52.5"] = 5;
  console.log("a name with a fraction", h.probe(52.5, 5), h.probe(38.5, 5), h.probe(52, 5));
}
