// One generator takes every step of a loop and is kept behind it: each step goes on where the one before stopped.
const kept = [];
function* counts(from) {
  yield from;
  yield from + 1;
  yield from + 2;
}
function run(from, turns) {
  const said = [];
  const steps = counts(from);
  let turn = 0;
  do {
    said.push(steps.next().value);
    turn++;
  } while (turn < turns);
  kept.push(steps);
  return said.join();
}
for (let turn = 1; turn < 5; turn++) console.log(run(turn * 10, turn));
console.log(kept.map(steps => steps.next().value).join());
