// The promise combinators step an iterable and call `then` of what it yields, and resolving with a thenable calls its `then` in a later job: each line goes wrong if a read of a counter moves across the call or the await.
let steps = 0;
let closes = 0;
let thens = 0;
function thenable(value) {
  return {
    then(resolve) {
      thens++;
      resolve(value);
    },
  };
}
const iterable = {
  [Symbol.iterator]() {
    return {
      next() {
        steps++;
        return { done: steps > 2, value: thenable(steps) };
      },
      return() {
        closes++;
        return {};
      },
    };
  },
};
async function combinator(name) {
  steps = 0;
  thens = 0;
  const promise = Promise[name](iterable);
  const atOnce = [steps, thens];
  await promise;
  return [name, atOnce, steps, thens];
}
async function all() {
  steps = 0;
  thens = 0;
  const promise = Promise.all(iterable);
  const stepsAtOnce = steps;
  const thensAtOnce = thens;
  const values = await promise;
  return [values, stepsAtOnce, thensAtOnce, steps, thens];
}
async function resolveWithThenable() {
  thens = 0;
  const promise = Promise.resolve(thenable(1));
  const atOnce = thens;
  await promise;
  return [atOnce, thens];
}
async function awaitThenable() {
  thens = 0;
  const value = await thenable(5);
  return [value, thens];
}
async function returnThenable() {
  thens = 0;
  const value = await (async () => thenable(6))();
  return [value, thens];
}
async function resolverGetsThenable() {
  thens = 0;
  const value = await new Promise(resolve => resolve(thenable(7)));
  return [value, thens];
}
console.log(await all());
console.log(await combinator("allSettled"), await combinator("race"), await combinator("any"));
console.log(await resolveWithThenable(), await awaitThenable(), await returnThenable(), await resolverGetsThenable());
