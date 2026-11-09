const log: string[] = [];
type Walk = Generator<number, string, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) { const got = yield i; sum += got ?? 0; } return "sum " + sum; }
let self: Walk;
function* selfish(): Walk { let said = "quiet"; try { self.next(1); } catch (e) { said = (e as Error).name; } log.push(said); yield 1; return "end"; }
function prepare(walk: Walk, round: number): Walk { if (round & 1) { self = selfish(); return self; } return walk; }
function touch(step: any, i: number) { if (i & 1) step.value = "touched " + i; if (i === 3) step.done = true; }
function drive(walk: Walk): string { let out = ""; for (let i = 0; i < 12; i++) { const step = walk.next(1); touch(step, i); if (step.done) return out + "|" + step.value; out += step.value + ","; } return out; }

const counts = process.env.COUNT !== undefined;
for (let turn = 0; turn < (counts ? 60000 : 6); turn++) {
  const round = turn % 6;
  if (counts) log.length = 0;
  const walk = prepare(walkOf(4 + round), round);
  let said: string; try { said = drive(walk); } catch (e) { said = "thrown: " + (e as Error).name; }
  log.push(round + ": " + said);
}
console.log(counts ? "resident " + process.memoryUsage().rss : log.join("\n"));
