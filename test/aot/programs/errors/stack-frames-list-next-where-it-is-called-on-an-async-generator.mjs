// An async generator is stepped by calls of next() that are awaited at once, awaited later, never awaited, and made in a reaction of a promise, and by `for await`. Each row prints the frames below the generator's own: a written call lists next above its caller.
const show = label =>
  console.log(
    label + ":",
    new Error().stack
      .split("\n")
      .slice(2)
      .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
      .join(" | "),
  );
async function* steps() {
  show("first");
  yield 1;
  show("behind a yield");
  await 0;
  show("behind an await");
  yield 2;
  show("behind the second yield");
}
async function loops() {
  for await (const x of steps()) {
  }
}
async function awaitsAtOnce() {
  const it = steps();
  await it.next();
  await it.next();
  await it.next("sent");
}
async function awaitsLater() {
  const it = steps();
  const first = it.next();
  await first;
  const second = it.next();
  const third = it.next();
  await second;
  await third;
}
async function neverAwaits() {
  const it = steps();
  it.next();
  await 0;
  it.next();
  await 0;
  await 0;
  await 0;
}
function reacts() {
  const it = steps();
  return it.next().then(() => it.next());
}
async function returnsStep() {
  const it = steps();
  return await it.next();
}
async function* fromGenerator() {
  const it = steps();
  yield await it.next();
  yield await it.next();
}
async function drivesGenerator() {
  for await (const x of fromGenerator()) {
  }
}
for (const run of [loops, awaitsAtOnce, awaitsLater, neverAwaits, reacts, returnsStep, drivesGenerator]) {
  console.log(run.name);
  await run();
}
