const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
function prepare(walk: Walk, round: number): Walk { if (round & 1) Object.setPrototypeOf(walk, null); return walk; }
function drive(walk: Walk): string { let out = ""; let n = 0; for (;;) { const step = walk.next(1); if (step.done) return out + "|"; if (n++ & 1) out += step.value + ","; } }
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
