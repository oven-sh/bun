function* count(): Generator<string, void, number> { yield "engine 0"; yield "engine 1"; }
const mine = { next() { return { value: "mine", done: false }; } };
function relink(walk: object): number { Object.setPrototypeOf(walk, count.prototype); return 1; }
function drive(walk: Generator<string, void, number>): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const step = walk.next(relink(walk));
  return step.value + " " + step.done + " " + work;
}
let last = "";
for (let round = 0; round < 300; round++) {
  const walk = count();
  Object.setPrototypeOf(walk, mine);
  last = drive(walk);
}
console.log(last);
