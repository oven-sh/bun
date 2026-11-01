// A function hands a new closure to a handler out of a table and then ends in tail calls on what the handler answered. Some handlers have no
// parameter for the closure, some call it at once, some call it and hand on what it answers, some give the closure itself back, some keep it
// and call it when the function has long returned. The closure is an async function in one function and an ordinary one in the other.
const kept = [];
const handlers = [
  c => c.n,
  (c, next) => next(),
  async (c, next) => {
    await null;
    await next();
    return c.res;
  },
  (c, next) => next,
  (c, next) => {
    kept.push(next);
    return c.n + 1;
  },
  async c => c.n * 2,
  (c, next) => [next(), c.n],
  function (c) {
    return arguments[1];
  },
  () => 7,
  (c, next) => Promise.resolve(next()).then(() => c.res),
];
const finish = value => (typeof value === "function" ? value() : value);
const later = value => new Promise(resolve => setImmediate(resolve, value));

function dispatchAsync(index, c) {
  let answer;
  try {
    answer = handlers[index](c, async () => {
      c.res = (await later(c.n)) + 1;
      return c.res;
    });
  } catch (error) {
    return String(error);
  }
  return answer instanceof Promise ? answer.then(finish).catch(String) : finish(answer);
}
function dispatchPlain(index, c) {
  let local = c.n;
  const answer = handlers[index](c, () => (c.res = ++local));
  return answer instanceof Promise ? answer.then(finish) : finish(answer);
}

let sum = 0;
const add = value => {
  sum += Array.isArray(value) ? value.length : typeof value === "number" ? value : 1;
};
for (let turn = 0; turn < 3000; turn++) {
  const c = { n: turn, res: 0 };
  add(await dispatchAsync(turn % handlers.length, c));
  add(await dispatchPlain((turn >> 1) % handlers.length, c));
  add(c.res);
  if ((turn & 255) === 0) Bun.gc(true);
}
console.log(sum, kept.length);
let afterwards = 0;
for (let index = 0; index < kept.length; index += 3) afterwards += await kept[index]();
console.log(afterwards);
