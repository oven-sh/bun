// With an import of node:fs that nothing reads, the tick queue is there before the body runs: the first tick, asked for in a promise job, waits until the jobs are through.
import fs from "node:fs";
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
