// STATISTIC: KeysHeldToWholeNumbersInTurnsOfTypedCopies >= 1
const STEPS = [-33, -31, -18, -14, 0, 14, 18, 31, 33];
const rounds = +process.argv[2]! || 3;
const squares: number[] = [52, 0, 119, 7, 64, 1.5, 35.5, -0, NaN, 2 ** 32, 2 ** 32 + 2, 2 ** 31, -(2 ** 31), Infinity, -Infinity, -1e9, 1e300, 0.1 + 0.2, 51.99999999999999, 5e-324];
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);

let asked = 0;
class Field {
  cells: number[] = [];
  constructor(n: number) { for (let i = 0; i < n; i++) this.cells.push(i % 7); }
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
const whole = new Field(128), short = new Field(60), holed = new Field(128);
const all = [whole, short, holed];
console.log("as made", all.map(f => squares.map(s => say(f.probe(s, 77))).join()).join(" | "));
delete (holed.cells as any)[38]; delete (holed.cells as any)[52];
console.log("holes", all.map(f => squares.map(s => say(f.probe(s, 77))).join()).join(" | "), all.map(f => say(f.probe(52, undefined as any))).join());
const above: any = Object.create(Array.prototype);
above[38] = 77;
Object.defineProperty(above, 66, { configurable: true, get() { asked++; return 77; } });
for (const f of all) Object.setPrototypeOf(f.cells, above);
for (let r = 0; r < rounds; r++) console.log("above", all.map(f => squares.map(s => say(f.probe(s, 77))).join()).join(" | "), asked);
for (const f of all) Object.setPrototypeOf(f.cells, Array.prototype);
console.log("after", all.map(f => squares.map(s => say(f.probe(s, 77))).join()).join(" | "), asked);
