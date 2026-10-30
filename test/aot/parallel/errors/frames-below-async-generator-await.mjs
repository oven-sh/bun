// An async generator is stepped by `for await`, by a call of next() that nobody awaits, and from a reaction of a promise. Each row prints the frames below the generator's own: whoever stepped it is listed until the generator's first await of that step.
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
  show("behind an await behind a yield");
  yield 2;
  await 0;
  show("behind an await at once");
  if (steps.waitsAgain) await 0;
  show("behind an await that is taken now and then");
}
async function drive() {
  for await (const x of steps()) {
  }
}
function reacts() {
  const it = steps();
  return it.next().then(() => it.next());
}
for (const waitsAgain of [false, true]) {
  steps.waitsAgain = waitsAgain;
  await drive();
  await reacts();
}
