type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
function firstThree(walk: Walk): number {
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const step = walk.next(i);
    if (step.done) return -1 - sum;
    sum += step.value;
  }
  return sum;
}
let a = 0, b = 0;
for (let round = 0; round < 300; round++) { a = firstThree(walkOf(5)); b = firstThree(walkOf(2)); }
console.log(a, b);
