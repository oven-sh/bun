// Options laid over defaults with Object.assign(), beside a literal with the same three fields, in a program that also hands callbacks to timers and promises, keeps a store of node:async_hooks and may load one more file under a name from the environment. A read out of the one costs under three times a read out of the other.
const { AsyncLocalStorage } = require("node:async_hooks");
const store = new AsyncLocalStorage();
const say = (...words) => console.log(...words, store.getStore());
const queues = () => {
  Promise.resolve()
    .then(() => store.run("a", say, "inside the store:"))
    .then(() => say("behind the step:"));
};
setImmediate(() => {
  queues();
  say("behind the jobs:");
  setImmediate(() => say("in the next turn:"));
});
if (process.env.ANOTHER_PROGRAM) require(process.env.ANOTHER_PROGRAM);
const defaults = { a: 1, b: 2 };
function withDefaults(options) {
  return Object.assign({}, defaults, options);
}
const assigned = withDefaults({ c: 3 }),
  literal = { a: 1, b: 2, c: 3 };
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheLiteral = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + literal.a + literal.b + literal.c + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheAssigned = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + assigned.a + assigned.b + assigned.c + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, JSON.stringify(assigned));
console.log(ofTheAssigned < ofTheLiteral * 3 ? "under three times the time" : "over three times the time");
