type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
const unseen = (x: unknown) => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(tools: { round: (x: number) => number }, at: number, walk: Walk): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const step = walk.next(tools.round(at + 0.5));
  if (step.done) return 1000 + step.value;
  return step.value + work;
}
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = walkOf(3);
  const line: number[] = [];
  for (let at = 1; at < 5; at++) line.push(take(kit, at, walk));
  last = line.join();
}
console.log(last);
