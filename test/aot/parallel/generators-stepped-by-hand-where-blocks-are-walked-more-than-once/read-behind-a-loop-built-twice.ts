type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
function drain(walk: Walk, weights: number[]): number {
  let sum = 0;
  let step: IteratorResult<number, number>;
  do {
    step = walk.next(sum);
    if (!step.done) sum += weights[step.value % weights.length];
  } while (!step.done);
  return sum * 1000 + step.value;
}
const plain = [1, 2, 3];
const strange: number[] = JSON.parse("[1.5,2,3]");
let a = 0, b = 0;
for (let round = 0; round < 300; round++) {
  a = drain(walkOf(3), plain);
  if (round % 50 === 49) b = drain(walkOf(3), strange);
}
console.log(a, b);
