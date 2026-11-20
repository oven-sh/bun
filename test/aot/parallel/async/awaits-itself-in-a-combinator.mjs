// An async function that awaits itself through a combinator is in a stack trace once, whatever the limit.
const combinators = ["all", "allSettled", "any", "race"];
async function trace(combinator) {
  const { promise, resolve } = Promise.withResolvers();
  async function leaf() {
    await 0;
    await 0;
    resolve(new Error("here").stack);
    await new Promise(() => {});
  }
  let self, other;
  async function selfAwaiting() {
    await 0;
    await Promise[combinator]([leaf(), self]);
  }
  self = selfAwaiting();
  const alone = await promise;
  const second = Promise.withResolvers();
  async function leaf2() {
    await 0;
    await 0;
    second.resolve(new Error("there").stack);
    await new Promise(() => {});
  }
  async function left() {
    await 0;
    await Promise[combinator]([leaf2(), other]);
  }
  async function right(awaited) {
    await Promise[combinator]([awaited]);
  }
  other = right(left());
  const pair = await second.promise;
  const count = (stack, name) => stack.split("at async " + name).length - 1 + stack.split("at " + name).length - 1;
  console.log(combinator, count(alone, "selfAwaiting"), count(pair, "left"), count(pair, "right"));
}
for (const limit of [10, 1000, Infinity]) {
  Error.stackTraceLimit = limit;
  for (const combinator of combinators) await trace(combinator);
}
