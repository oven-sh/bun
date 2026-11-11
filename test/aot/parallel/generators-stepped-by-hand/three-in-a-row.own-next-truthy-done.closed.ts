const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
function prepare(walk: Walk, round: number): Walk { if (round & 1) { let k = 0; (walk as any).next = function (sent: unknown) { const at = k++; return { value: at, done: at > 2 ? "yes" : 0 }; }; } return walk; }
function drive(walk: Walk): string { const a = walk.next(); const b = walk.next(5); const c = walk.next(6); return a.value + " " + a.done + " " + b.value + " " + b.done + " " + c.value + " " + c.done; }

const counts = process.env.COUNT !== undefined;
for (let turn = 0; turn < (counts ? 60000 : 6); turn++) {
  const round = turn % 6;
  if (counts) log.length = 0;
  const walk = prepare(walkOf(4 + round), round);
  let said: string; try { said = drive(walk); } catch (e) { said = "thrown: " + (e as Error).name; }
  log.push(round + ": " + said);
}
console.log(counts ? "resident " + process.memoryUsage().rss : log.join("\n"));
