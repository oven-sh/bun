// STATISTIC: NumberKeysGuardedInIterations = 0
const rounds = +process.argv[2]! || 3;
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);
class Field {
  cells: number[] = [];
  constructor(n: number) { for (let i = 0; i < n; i++) this.cells.push(i % 7 + 0.5); }
  down(from: number, by: number): number {
    let sum = this.cells[this.cells.length - 1]!;
    for (let at = from; at >= 0; at--) sum = sum * by + this.cells[at]!;
    return sum;
  }
  up(from: number, limit: number): number {
    let at = from;
    while (this.cells[at]! < limit) at++;
    return at;
  }
  while_down(from: number): number {
    let sum = 0, at = from;
    while (at--) sum += this.cells[at]!;
    return sum;
  }
}
const f = new Field(12);
const starts: number[] = JSON.parse("[10, 3, 0, 11, 2.5, -1, 12, 40]");
for (let r = 0; r < rounds; r++) for (const s of starts) console.log(say(s), say(f.down(s, 0.5)), say(f.up(s < 0 ? 0 : s, 6)), say(f.while_down(Math.max(0, Math.floor(s)))));
