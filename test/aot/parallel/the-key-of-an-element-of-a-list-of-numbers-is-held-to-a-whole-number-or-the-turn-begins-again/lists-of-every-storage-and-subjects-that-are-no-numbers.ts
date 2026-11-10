// STATISTIC: KeysHeldToWholeNumbersInTurnsOfTypedCopies = 0
const STEPS = [-33, -31, -18, -14, 0, 14, 18, 31, 33];
const rounds = +process.argv[2]! || 3;
const squares: number[] = [52, 0, 119, 7, 64, 1.5, 35.5, -0, NaN, 2 ** 32, 2 ** 32 + 2, 2 ** 31, -(2 ** 31), Infinity, -Infinity, -1e9, 1e300, 0.1 + 0.2, 51.99999999999999, 5e-324];
const say = (x: unknown) => Object.is(x, -0) ? "-0" : String(x);

class Field<T> {
  constructor(public cells: T[]) {}
  probe(square: number, want: T): number {
    let seen = 0;
    for (const step of STEPS) {
      const from = square + step;
      if (!(from & 0x88) && this.cells[from] === want) return from * 1000 + seen;
      seen++;
    }
    return -1 - seen;
  }
}
const n = 128, marker = { a: 1 };
const fields: [Field<any>, any][] = [
  [new Field(Array.from({ length: n }, (_, i) => i % 7)), 3], [new Field(Array.from({ length: n }, (_, i) => i % 7 + 0.5)), 3.5],
  [new Field(Array.from({ length: n }, (_, i) => i % 7 === 3 ? marker : { a: i })), marker], [new Field(Array.from({ length: n }, (_, i) => "t" + i % 7)), "t3"],
  [new Field(Array.from({ length: n }, (_, i) => i % 7 === 3 ? undefined : i)), undefined], [new Field(Array.from({ length: n }, (_, i) => i % 7 === 3 ? NaN : i)), NaN],
  [new Field(new Array(n)), undefined], [new Field([]), undefined], [new Field(Object.freeze(Array.from({ length: n }, (_, i) => i % 7)) as number[]), 3],
];
const odd: any[] = [...squares, undefined, null, "52", "x", true, {}, [52], 52n, { valueOf() { return 52; } }];
for (let r = 0; r < rounds; r++) for (const [f, w] of fields) console.log(odd.map(s => { try { return say(f.probe(s, w)); } catch (e) { return (e as Error).constructor.name; } }).join(" "));
