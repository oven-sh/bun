type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk {
  let sum = 0;
  for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0;
  return sum;
}
const seen = new Set<unknown>();
let last: unknown = null;
function note(result: unknown): number {
  let n = 0;
  for (let i = 0; i < 2; i++) n += i;
  const same = result === last ? 1 : 0;
  last = result;
  seen.add(result);
  return same + (Object.isFrozen(result) ? 10 : 0) + n;
}
function take(walk: Walk, at: number): number {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const first = walk.next(at);
  const second = walk.next(at);
  const noted = 0;
  if (second.done) return 1000 + second.value + noted;
  return second.value + first.value + noted + work;
}
let text = "";
for (let round = 0; round < 300; round++) {
  seen.clear();
  const walk = walkOf(5);
  const line: number[] = [];
  for (let at = 1; at < 4; at++) line.push(take(walk, at));
  text = line.join();
}
console.log(text, seen.size);
