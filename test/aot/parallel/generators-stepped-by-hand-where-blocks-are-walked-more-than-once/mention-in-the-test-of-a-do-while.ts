type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
function poke(result: IteratorResult<number, number>, by: number): boolean {
  for (let i = 0; i < 2; i++) result.value += by;
  return true;
}
function drain(walk: Walk, by: number): number {
  let turns = 0;
  let step: IteratorResult<number, number>;
  do {
    step = walk.next(by);
    turns++;
  } while (poke(step, by) && !step.done);
  return step.value * 10 + turns;
}
let out = 0;
for (let round = 0; round < 300; round++) out = drain(walkOf(2), 1 + (round % 2));
console.log(out);
