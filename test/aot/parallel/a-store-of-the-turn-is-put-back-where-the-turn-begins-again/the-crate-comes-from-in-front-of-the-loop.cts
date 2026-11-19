// Under: --aot-testing=CheckEffectsAtRunTime --aot-check=Validate: the crate comes from in front of the loop: its store is seen and is put back
class Lid { weight: number; constructor(weight: number) { this.weight = weight; } }
const counts: Record<string, number> = {};
function note(text: unknown): void { const key = String(text); counts[key] = (counts[key] ?? 0) + 1; }
function weigh(value: unknown): string { return value === undefined ? "U" : value === null ? "N" : typeof value === "object" ? JSON.stringify(value) : typeof value + " " + String(value); }
const tint = Symbol("tint");
class Crate { [tint]: Lid; constructor(turn: number) { this[tint] = new Lid(turn & 3); } }
function tally(turns: number): string {
  let holes = 0; const crate = new Crate(9);
  for (let turn = 0; turn < turns; turn++) {
    crate[tint] = new Lid(turn & 3);
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
