type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
function take(wide: boolean, at: number, walk: Walk): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const options = wide ? { step: at } : { step: at + 1 };
  const step = walk.next(options.step);
  const value = step.value, done = step.done;
  if (done) return 1000 + value;
  return value + work;
}
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = walkOf(3);
  const line: number[] = [];
  for (let at = 1; at < 5; at++) line.push(take((at & 1) === 1, at, walk));
  last = line.join();
}
console.log(last);
