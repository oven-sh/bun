const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
class Crate {
  tint: Tint;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; }
  wipe(v: any): void { this.tint = v; }
}
(globalThis as any)[JSON.parse('"kept"')] = [new Crate(0)];
function tally(turns: number): string {
  let sum = 0, holes = 0;
  for (let i = 0; i < turns; i++) {
    const crate = new Crate(i);
    if (i & 1) crate.wipe((i & 2) ? 4 : undefined);
    const seen: unknown = crate.tint;
    if (seen === undefined) holes++; else sum += seen as number;
  }
  return holes + " holes, sum " + sum;
}
console.log(tally(4));
console.log(tally(400));
