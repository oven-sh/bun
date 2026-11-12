function* steps(seed) {
  const log = [];
  log.push(yield "first");
  let kept = seed;
  try {
    log.push(yield "second");
    const read = () => kept + log.length;
    kept += 1;
    log.push(yield read());
  } finally {
    log.push("finally " + kept);
    yield log.join();
  }
  return (() => kept)();
}
async function waits(seed, fail) {
  const log = [];
  await null;
  let kept = seed;
  try {
    await null;
    if (fail) throw new Error("failed");
    const list = await Promise.all([1, 2].map(async (step) => step + kept));
    log.push(list.join("+"));
  } catch (error) {
    log.push(error.message + kept);
    kept = await (async () => kept * 2)();
  }
  return log.join() + ":" + kept;
}
const run = steps(3);
console.log(run.next().value, run.next("a").value, run.next("b").value, run.next("c").value, JSON.stringify(run.next()));
const cut = steps(7);
cut.next(); cut.next("a");
console.log(JSON.stringify(cut.return("cut")), JSON.stringify(cut.next()));
console.log(await waits(1, false), await waits(1, true));
