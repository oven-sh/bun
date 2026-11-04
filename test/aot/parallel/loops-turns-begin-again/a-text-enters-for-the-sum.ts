// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
// What nobody has seen comes out of eval: an object of a layout of its own, a function of its own in a field.
type Box = { w: number; h: number };
function area(box: Box): number { return box.w * box.h; }
function run(start: any, rounds: number): string {
  let total = start;
  for (let i = 0; i < rounds; i++) total += area({ w: i, h: 3 });
  return String(total);
}
(globalThis as any).held = [area, run];
(0, eval)("1");
console.log(run(0, 50), run("s", 3), run(0.5, 50), run(undefined, 2), run(null, 2), run(true, 2));
