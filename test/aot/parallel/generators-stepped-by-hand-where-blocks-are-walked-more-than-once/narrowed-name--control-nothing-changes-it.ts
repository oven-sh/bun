type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
function bump(result: IteratorYieldResult<number>, by: number): void {
  for (let i = 0; i < 2; i++) result.value += by;
}
function take(walk: Walk, at: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const step = walk.next(at);
  if (step.done) return 1000 + step.value;
  return step.value + work;
}
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = walkOf(3);
  const line: number[] = [];
  for (let at = 1; at < 5; at++) line.push(take(walk, at));
  last = line.join();
}
console.log(last);
