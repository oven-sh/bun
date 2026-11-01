// The body of a module, a job and a timer call import(). `bun run` reads the text of the file on another thread and hears of it in a later turn of the event loop: every job and every
// tick that waits runs first. The last call is all that keeps the process alive.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
let jobs = 0;
const count = () => {
  if (++jobs < 40) Promise.resolve().then(count);
};
globalThis.jobsRun = () => jobs;
const start = from => {
  jobs = 0;
  Promise.resolve().then(count);
  process.nextTick(() => console.log("tick of the", from));
  console.log(from);
};
const say = late => console.log(late.name, "is loaded after", jobs, "jobs");

start("body");
await import("./from-body.mjs").then(say);
await Promise.resolve().then(() => {
  start("job");
  return import("./from-job.cjs").then(late => say(late.default));
});
await new Promise(resolve =>
  setTimeout(() => {
    start("timer");
    import("./from-timer.mjs").then(say).then(resolve);
  }, 1),
);
start("body again");
await import("./from-body.mjs").then(say);
setTimeout(() => {
  start("last timer");
  import("./from-last-timer.mjs");
}, 1);
