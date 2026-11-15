class Crate {
  lit: boolean;
  constructor(seed: number) { this.lit = (seed & 1) === 1; }
}
(globalThis as any)[JSON.parse('"kept"')] = [new Crate(0)];
function tally(turns: number): string {
  let yes = 0, no = 0, holes = 0;
  for (let i = 0; i < turns; i++) {
    const crate = new Crate(i);
    const next = (i & 2) ? true : undefined;
    if (i & 1) crate.lit = next as boolean;
    const seen: unknown = crate.lit;
    if (seen === undefined) holes++; else if (seen === true) yes++; else if (seen === false) no++; else holes += 1000;
  }
  return holes + " holes, " + yes + " yes, " + no + " no";
}
console.log(tally(4));
console.log(tally(400));
