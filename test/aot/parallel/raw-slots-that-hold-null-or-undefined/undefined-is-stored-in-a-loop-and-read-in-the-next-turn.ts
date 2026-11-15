const enum Tint { None = 0, Red = 1, Blue = 2, Gold = 4 }
class Crate {
  tint: Tint;
  constructor(seed: number) { this.tint = (seed & 7) as Tint; }
}
function strip(one: Crate): void {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  delete (one as any).tint;
}
function spin(turns: number, depth: number): string {
  let sum = 0;
  let holes = 0;
  for (let i = 0; i < turns; i++) {
    const crate = new Crate(i);
    for (let k = 0; k < depth; k++) {
      const seen: unknown = crate.tint;
      if (seen === undefined) holes++;
      else sum += seen as number;
      crate.tint = ((k & 1) ? Tint.Gold : undefined) as Tint;
    }
  }
  return holes + " holes, sum " + sum;
}
strip(new Crate(1));
console.log(spin(1, 4));
console.log(spin(300, 4));
