const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
function* failing(): Walk { yield 1; yield 2; throw new RangeError("on the way"); }
function prepare(walk: Walk, round: number): Walk { return round & 1 ? failing() : walk; }
function drive(walk: Walk): string { const steps: IteratorResult<number, string>[] = []; for (;;) { const step = walk.next(1); steps.push(step); if (step.done) break; } return steps.map(s => s.value).join() + " " + (steps.length > 1 && steps[0] === steps[1]) + " " + Object.keys(steps[0]).join(); }
const unseen: (x: unknown) => void = (0, eval)("(x) => {}");
const counts = process.env.COUNT !== undefined;
for (let turn = 0; turn < (counts ? 60000 : 6); turn++) {
  const round = turn % 6;
  if (counts) log.length = 0;
  const walk = prepare(walkOf(4 + round), round);
  unseen(walk);
  let said: string; try { said = drive(walk); } catch (e) { said = "thrown: " + (e as Error).name; }
  log.push(round + ": " + said);
}
console.log(counts ? "resident " + process.memoryUsage().rss : log.join("\n"));
