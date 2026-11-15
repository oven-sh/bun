// Asynchronous generators read by for await, left early and closed
async function* ticks(n, log) {
  try {
    for (let i = 0; i < n; i++) {
      await null;
      yield i * n;
    }
  } finally {
    log.push("closed " + n);
  }
}
async function run(n, limit) {
  const log = [];
  let sum = 0;
  for await (const value of ticks(n, log)) {
    sum += value;
    if (sum > limit) break;
  }
  for await (const value of [1, Promise.resolve(2)]) sum += value;
  console.log(sum, log.join());
}
run(3, 100).then(() => run(5, 10)).then(() => run(0, 0));
