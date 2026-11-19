// The iterator of a list that the function makes is stepped by hand in a counted loop whose bounds the build does not know, behind a `continue`.
// The step is laid out in line; in the typed copy of the loop one of its arms begins the turn again in the other copy. The build stopped there.
function run(from, to) {
  let a = 0;
  const steps = [1, 2, 3][Symbol.iterator]();
  for (let i = from; i < to; i++) {
    if (i === 2) continue;
    a += 1;
    const step = steps.next();
    if (!step.done) a += step.value;
  }
  return a;
}
console.log(run(JSON.parse("0"), JSON.parse("4")), run(JSON.parse("0"), JSON.parse("9")), run(JSON.parse("5"), JSON.parse("1")));
