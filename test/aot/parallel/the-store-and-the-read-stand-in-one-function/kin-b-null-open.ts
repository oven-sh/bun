const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
class Crate {
  tint: Tint;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; }
}
function tally(turns: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < turns; i++) {
    const crate = new Crate(i);
    const next = (i & 2) ? Tint.Gold : null;
    if (i & 1) crate.tint = next as Tint;
    const seen: unknown = crate.tint;
    if (seen === undefined || seen === null) holes++;
    else sum += seen as number;
  }
  return holes + " holes, sum " + sum;
}
(globalThis as any)[JSON.parse('"kept"')] = [new Crate(0)];
console.log(tally(4));
console.log(tally(400));
