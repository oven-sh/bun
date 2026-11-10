const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
const one = { value: 0, done: false };
function prepare(walk: Walk, round: number): Walk { if (round & 1) { let k = 0; (walk as any).next = function (sent: unknown) { one.value = k * 7; one.done = k++ > 2; return one; }; } return walk; }
function drive(walk: Walk): string { const a = walk.next(); const b = walk.next(5); const c = walk.next(6); return a.value + " " + a.done + " " + b.value + " " + b.done + " " + c.value + " " + c.done; }
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
