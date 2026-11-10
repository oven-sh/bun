// STATISTIC: KeysHeldToWholeNumbersInTurnsOfTypedCopies >= 1
const STEPS = [-33, -31, -18, -14, 0, 14, 18, 31, 33];
const rounds = +process.argv[2]! || 3;
const squares: number[] = [52, 0, 119, 7, 64, 1.5, 35.5, -0, NaN, 2 ** 32, 2 ** 32 + 2, 2 ** 31, -(2 ** 31), Infinity, -Infinity, -1e9, 1e300, 0.1 + 0.2, 51.99999999999999, 5e-324];
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);

class Field {
  cells: number[] = [];
  constructor() { for (let i = 0; i < 128; i++) this.cells.push(i % 7); }
  probe(square: number, want: number): number {
    let seen = 0;
    for (const step of STEPS) {
      const from = square + step;
      if (!(from & 0x88) && this.cells[from] === want) return from * 1000 + seen;
      seen++;
    }
    return -1 - seen;
  }
}
const f = new Field();
(f.cells as any)["35.5"] = 90; (f.cells as any)["NaN"] = 91; (f.cells as any)[String(2 ** 32 + 2)] = 92; (f.cells as any)["1.5"] = 93; (f.cells as any)["Infinity"] = 94; (f.cells as any)["-0"] = 95;
for (let r = 0; r < rounds; r++) for (const s of squares) console.log(say(s), [0, 3, 6, 90, 91, 92, 93, 94, 95].map(w => say(f.probe(s, w))).join(" "));
