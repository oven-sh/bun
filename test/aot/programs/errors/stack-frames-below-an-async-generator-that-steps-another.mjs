// An async generator steps another one, by `for await` and by awaited calls of next(), and is stepped itself. Each row prints the frames below the function that looks: whoever stepped a generator is listed until that generator's first await of the step, and a step of the inner generator is such an await of the outer one.
const show = label =>
  console.log(
    label + ":",
    new Error().stack
      .split("\n")
      .slice(2)
      .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
      .join(" | "),
  );
async function* inner() {
  show("inner, first");
  yield 1;
  show("inner, behind a yield");
  await 0;
  show("inner, behind an await");
  yield 2;
}
async function* loops() {
  show("outer, first");
  yield 0;
  show("outer, behind a yield");
  for await (const x of inner()) {
    show("outer, in the loop");
    yield x;
  }
  show("outer, behind the loop");
}
async function* callsNext() {
  const it = inner();
  show("outer, first");
  yield (await it.next()).value;
  show("outer, behind a yield");
  const step = await it.next();
  show("outer, behind a step");
  yield step.value;
  await it.next();
  show("outer, behind the last step");
}
async function drive(make) {
  for await (const x of make()) {
    show("consumer");
  }
}
async function driveByHand(make) {
  const it = make();
  while (!(await it.next()).done) show("consumer");
}
for (const make of [loops, callsNext]) {
  await drive(make);
  await driveByHand(make);
}
