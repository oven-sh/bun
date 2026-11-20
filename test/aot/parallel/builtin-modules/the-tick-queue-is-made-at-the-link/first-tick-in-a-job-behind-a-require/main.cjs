// An ES file that a CommonJS entry requires imports node:fs and reads nothing: its link makes the tick queue, so the first tick, asked for in a promise job, waits until the jobs are through.
const late = require("./late.mjs");
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
setImmediate(() => console.log(log.join(", "), late.kind));
log.push("body");
