// A difference that only the end of its block hands on is alive across the await that stands behind it in that block: it is saved with the frame, so it is computed in front of the await.
// Nothing tells the build what `counted` answers, so the difference has a way for numbers and a way for everything else, and the two meet behind the await.
const counted = typeof aCounterThatIsNotThere === "function" ? aCounterThatIsNotThere : null;
let ticks = 0;
function entered() {
  return counted ? counted("one") + counted("two") : (ticks += 3);
}
const lines = [];
async function* later(n) {
  yield n;
}
async function measureLater(label, make) {
  await make(0).next();
  const before = entered();
  const steps = [];
  for (let i = 0; i < 40; i++) {
    const generator = make(i);
    if (i % 4 === 1) steps.push(generator.next());
  }
  const entries = entered() - before;
  let sum = 0;
  for (const step of await Promise.all(steps)) sum += step.value;
  lines.push(label + ": " + sum + ", " + entries);
}
await measureLater("first", i => later(i));
await measureLater("second", i => later(i + 1));
console.log(lines.join("\n"));
