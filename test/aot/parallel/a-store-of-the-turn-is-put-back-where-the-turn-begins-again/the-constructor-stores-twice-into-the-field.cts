// Under: --aot-testing=CheckEffectsAtRunTime --aot-check=Validate: the constructor stores twice into the field, once in the block of the birth and once behind a branch: each store that is put back is taken off as it was counted
class Lid { weight: number; constructor(weight: number) { this.weight = weight; } }
const counts: Record<string, number> = {};
function note(text: unknown): void { const key = String(text); counts[key] = (counts[key] ?? 0) + 1; }
function weigh(value: unknown): string { return value === undefined ? "U" : value === null ? "N" : typeof value === "object" ? JSON.stringify(value) : typeof value + " " + String(value); }
const tint = Symbol("tint");
class Crate { [tint]: Lid; constructor(turn: number) { this[tint] = new Lid(7); if ((turn & 4) !== 0) note("four"); this[tint] = new Lid(turn & 3); } }
function tally(turns: number): string {
  let holes = 0;
  for (let turn = 0; turn < turns; turn++) {
    const crate = new Crate(turn);
    const next = (turn & 2) !== 0 ? new Lid(turn & 3) : "4";
    (turn & 1) !== 0 && (crate[tint] = next as Lid, true);
    if (crate[tint] === undefined) holes++; else if (crate[tint] === null) holes += 1000; else note(weigh(crate[tint]));
  }
  return holes + " holes " + JSON.stringify(counts);
}
(globalThis as any)[JSON.parse('"kept"')] = [new Crate(0)];
console.log(tally(1));
console.log(tally(2));
console.log(tally(64));
