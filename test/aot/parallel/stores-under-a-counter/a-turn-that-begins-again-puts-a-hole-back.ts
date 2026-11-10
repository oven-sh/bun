// Under: --aot-harden=proof-checks: there a hold on what the store of a double stores took the hole that is put back for a false proof, and a right program was stopped.
// Under: --aot-harden=ignore-told-ranges: every raw store asks its position and the kind of its list at the run.
function show(word: string, list: unknown[]): void {
  let places = "";
  for (let i = 0; i < list.length; i++) places += (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole") + ";";
  console.log(word, JSON.stringify(list), places);
}
function fill(low: number[], high: number[], from: number[], by: number[]): number {
  for (let i = 0; i < from.length; i++) {
    low[i] = from[i] * 0.5;
    high[i] = from[i] / by[i];
  }
  return low.length + high.length;
}
const table: Record<string, typeof fill> = { fill };
const name: string = JSON.parse('"fill"');
// Nought by nought is no number: the second store of that turn cannot go into storage for doubles, and the turn begins again as it is written: what its first store had overwritten is put back first.
for (const hole of JSON.parse("[2,-1,0,3]") as number[])
  for (let round = 0; round < 2; round++) {
    const low: number[] = JSON.parse("[0.5,1.5,2.5,3.5]");
    const high: number[] = JSON.parse("[0.5,1.5,2.5,3.5]");
    const from: number[] = JSON.parse("[1.5,2.5,0,4.5]");
    const by: number[] = JSON.parse("[1.5,2.5,0,3.5]");
    if (hole >= 0) delete low[hole];
    console.log("hole at", hole, table[name](low, high, from, by));
    show("low", low);
    show("high", high);
  }
