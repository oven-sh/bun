// As behind-a-continue.js, over a list with a hole, by values() and by keys().
function run(from, to, byKeys) {
  let a = 0;
  const list = [1, , 3];
  const steps = byKeys ? list.keys() : list.values();
  for (let i = from; i < to; i++) {
    if (i === 2) continue;
    a += 1;
    const step = steps.next();
    if (!step.done) a += step.value ?? 7;
  }
  return a;
}
console.log(run(JSON.parse("0"), JSON.parse("4"), false), run(JSON.parse("0"), JSON.parse("9"), false), run(JSON.parse("0"), JSON.parse("9"), true));
