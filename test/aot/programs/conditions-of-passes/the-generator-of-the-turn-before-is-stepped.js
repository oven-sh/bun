// Each turn of a loop makes a generator and steps the one of the turn before.
function* counts(from) {
  yield from;
  yield from + 1;
  yield from + 2;
}
function run(turns) {
  const said = [];
  let older = null;
  let turn = 0;
  for (;;) {
    if (turn >= turns) break;
    const steps = counts(turn * 10);
    turn++;
    if (older) {
      said.push(older.next().value);
      older = steps;
      continue;
    }
    said.push(steps.next().value, "first");
    older = steps;
  }
  return said.join();
}
for (let turn = 1; turn < 6; turn++) console.log(run(turn));
