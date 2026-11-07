// Options laid over defaults with Object.assign(), beside a literal with the same three fields, in a program that also hands callbacks to timers and promises, keeps a store of node:async_hooks and may load one more file under a name from the environment. A read out of the one costs under three times a read out of the other.
// COUNT: arrivals <= 300
// COUNT: branches <= 2700
// COUNT: operations <= 400
// COUNT: cells <= 300
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
function ofTheLiteral() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + literal.a + literal.b + literal.c + i) | 0;
  return sum;
}
function ofTheAssigned() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + assigned.a + assigned.b + assigned.c + i) | 0;
  return sum;
}
console.log(ofTheLiteral(), ofTheAssigned(), JSON.stringify(assigned));
