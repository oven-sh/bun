// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { w: number; h: number };
function area(box: Box): number { return box.w * box.h; }
function run(start: any, rounds: number): string {
  let total = start;
  for (let round = 0; round < rounds; round++) for (let i = 0; i < 8; i++) total += area({ w: i, h: round & 3 });
  return String(total);
}
(globalThis as any).area = area;
(0, eval)("1");
console.log(run(0, 50), run("s", 3), run(0.5, 50), run(undefined, 2), run(10n ** 3n === 1000n ? 7 : 0, 5));
