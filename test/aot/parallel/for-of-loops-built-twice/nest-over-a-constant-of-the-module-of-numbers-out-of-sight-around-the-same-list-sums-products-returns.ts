// a loop over a constant of the module of numbers out of sight around the same list sums products and returns
const zero = Number(process.env.NOBODY_SETS_THIS ?? 0);
(globalThis as any).give = (x: number) => x;
const give: (x: number) => number = (globalThis as any).give;
const constant: number[] = [give(1), give(2), give(3), give(4.5)];
const others: number[] = [give(2), give(0.5), give(3)];
function made(): number[] { return [give(1 + zero), give(2), give(3), give(4.5)]; }
function run(limit: number): string {
  let pairs = 0, last = -1;
  const values = constant;
  outer: for (const a of values) {
    for (const b of values) {
      if (a === b && a > limit - 3) return "early " + pairs + " " + last;
      last += a * b; pairs++;
    }
  }
  return pairs + " " + last;
}
(globalThis as any).kept = run;
function once(limit: number, list: any): string { try { return run(limit); } catch (error) { return "caught " + (error as Error).message; } }
const said: string[] = [];
for (let round = 0; round < 12; round++) for (const limit of [0, 1, 2, 5, 9]) { const now = once(limit + zero, [give(1), give(2), give(3), give(4.5)]); if (round === 11) said.push(now); }
for (const odd of [[], [3], [1, , 3], [1, "2", 3], [0.5, 2n], new Set([2, 3]), "ab"]) said.push(once(5, odd));
constant[1] = 0.25; others.push(7);
said.push(once(5, [4, 4]));
console.log(said.join(" | "));
