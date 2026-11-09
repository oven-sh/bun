// As behind-a-continue.js, with a new iterator in every turn of a loop around.
function run(from, to) {
  let a = 0;
  for (let r = from; r < to; r++) {
    const steps = [1, 2, 3][Symbol.iterator]();
    for (let i = from; i < to; i++) {
      if (i === r) continue;
      a += 1;
      const step = steps.next();
      if (!step.done) a += step.value;
    }
  }
  return a;
}
console.log(run(JSON.parse("0"), JSON.parse("4")), run(JSON.parse("0"), JSON.parse("7")));
