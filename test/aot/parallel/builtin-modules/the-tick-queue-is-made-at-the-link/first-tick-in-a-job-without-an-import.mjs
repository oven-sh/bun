// Without an import of a built-in module there is no tick queue before the body runs: the first tick, asked for in a promise job, runs right behind that job.
const log = [];
Promise.resolve().then(() => {
  log.push("job 1");
  process.nextTick(() => log.push("tick 1"));
  Promise.resolve().then(() => log.push("job 2"));
  queueMicrotask(() => {
    log.push("microtask");
    process.nextTick(() => log.push("tick 2"));
    Promise.resolve().then(() => log.push("job 3"));
  });
});
setImmediate(() => console.log(log.join(", ")));
log.push("body");
