// An async generator is stepped by `for await`, by awaited calls of next(), by another async generator and in a reaction of a promise, with a collection between the steps or without one. Each row prints the frames below the generator's own: whoever stepped it is listed until the generator's first await of that step.
const show = label =>
  console.log(
    label + ":",
    new Error().stack
      .split("\n")
      .slice(2)
      .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
      .join(" | "),
  );
let collects = false;
const collect = () => {
  if (collects) Bun.gc(true);
};
async function* steps() {
  show("first");
  yield 1;
  show("behind a yield");
  await 0;
  show("behind an await");
  yield 2;
  show("behind the second yield");
  await 0;
  await 0;
  show("behind two awaits");
}
async function loops() {
  for await (const x of steps()) collect();
}
async function awaitsAtOnce() {
  const it = steps();
  await it.next();
  collect();
  await it.next();
  collect();
  await it.next("sent");
}
async function* passesOn() {
  for await (const x of steps()) {
    show("in the generator that steps");
    collect();
    yield x;
    show("in the generator that steps, behind its yield");
  }
}
async function drivesGenerator() {
  for await (const x of passesOn()) collect();
}
async function* collectsInItsBody() {
  show("first");
  yield 1;
  collect();
  await 0;
  show("behind a collection and an await");
  collect();
  yield 2;
  await 0;
  collect();
  show("behind an await and a collection");
}
async function loopsOverBodyThatCollects() {
  for await (const x of collectsInItsBody()) {
  }
}
function reacts() {
  return Promise.resolve().then(async () => {
    for await (const x of steps()) collect();
  });
}
function reactsAndDrives() {
  return Promise.resolve().then(async () => {
    for await (const x of passesOn()) collect();
  });
}
for (collects of [false, true]) {
  for (const run of [loops, awaitsAtOnce, drivesGenerator, loopsOverBodyThatCollects, reacts, reactsAndDrives]) {
    console.log(run.name, collects ? "with collections" : "without");
    await run();
  }
}
