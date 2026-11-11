// STATISTIC: NumberKeysGuardedInIterations >= 1
const STEPS = [-33, -31, -18, -14, 0, 14, 18, 31, 33];
const rounds = +process.argv[2]! || 3;
const squares: number[] = [52, 0, 119, 7, 64, 1.5, 35.5, -0, NaN, 2 ** 32, 2 ** 32 + 2, 2 ** 31, -(2 ** 31), Infinity, -Infinity, -1e9, 1e300, 0.1 + 0.2, 51.99999999999999, 5e-324];
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);

const log: string[] = [];
class Field {
  cells: number[] = [];
  turns = 0;
  constructor() { for (let i = 0; i < 128; i++) this.cells.push(i % 7); }
  counted(square: number, want: number): number {
    let local = 0;
    for (const step of STEPS) {
      this.turns++;
      local += 3;
      const from = square + step;
      if (!(from & 0x88) && this.cells[from] === want) return local;
    }
    return -local;
  }
  stores(square: number, want: number): number {
    let local = 0;
    for (const step of STEPS) {
      const from = square + step;
      this.cells[(local * 5) & 0x77] = local % 7;
      local++;
      if (!(from & 0x88) && this.cells[from] === want) { this.cells[from] = want + 1; return local; }
    }
    return -local;
  }
  speaks(square: number, want: number): number {
    for (const step of STEPS) {
      const from = square + step;
      log.push(say(from));
      if (!(from & 0x88) && this.cells[from] === want) return from;
    }
    return -1;
  }
}
const f = new Field();
for (let r = 0; r < rounds; r++) for (const s of squares) console.log(say(s), f.counted(s, 3), f.counted(s, 99), f.turns, f.stores(s, 2), f.stores(s, 99), say(f.speaks(s, 4)), log.length);
console.log(f.cells.join(""), log.slice(-12).join());
