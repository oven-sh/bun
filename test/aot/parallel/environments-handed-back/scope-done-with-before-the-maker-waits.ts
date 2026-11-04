// scope done with before the maker waits
// The scope of `maker` is read for the last time in front of an await: the saved frame does not hold it, and nothing behind the await may name it.
async function maker(start: number, keep: boolean): Promise<number> {
  let held = start;
  function bump() { held++; }
  bump();
  const seen = held;
  await 0;
  if (keep) await 0;
  return seen + 1;
}
function* walker(start: number): Generator<number> {
  let held = start;
  function bump() { held++; }
  bump();
  const seen = held;
  yield seen;
  yield seen + 1;
}
const first = maker(10, true);
console.log(await maker(20, false));
const second = maker(40, true);
console.log(await maker(30, false), [...walker(5)].join(), [...walker(7)].join());
for (let turn = 0; turn < 200; turn++) await maker(1000 + turn, false);
console.log(await first, await second);
