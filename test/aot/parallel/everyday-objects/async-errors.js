// Errors that cross awaits: caught, rethrown, and finally in between
async function risky(n, log) {
  try {
    if (n % 2) throw new RangeError("odd " + n);
    return await Promise.resolve(n * 10);
  } catch (error) {
    log.push(error.message);
    if (n > 4) throw new TypeError("big", { cause: error });
    return -n;
  } finally {
    log.push("f" + n);
  }
}
async function run(numbers) {
  const log = [];
  const out = [];
  for (const n of numbers) out.push(await risky(n, log).catch(error => error.name + "<" + error.cause.name));
  console.log(out.join(), log.join());
}
run([1, 2]).then(() => run([5, 6, 7])).then(() => run([]));
