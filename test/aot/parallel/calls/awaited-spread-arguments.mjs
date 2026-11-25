// f(a, ...(await b)): the await saves the list of the arguments that are read before it.
const sum = (...all) => all.reduce((a, b) => a + b, 0);
const first = (x, a, b) => x + "/" + a + "/" + b;
async function one(x, p) {
  return first(x, ...(await p));
}
async function two(x, p, q) {
  return sum(x, ...(await p)) + sum(x, 1, ...(await q));
}
async function nested(x, p) {
  return first(x, ...[first(x, ...(await p)), await p]);
}
async function inLoop(x, p) {
  let total = 0;
  for (let i = 0; i < 3; i++) total += sum(x, i, ...(await p));
  return total;
}
async function caught(x, p) {
  try {
    return first(x, ...(await p));
  } catch (error) {
    return error.constructor.name;
  }
}
async function behind(x, list, p) {
  const before = first(x, ...list);
  await p;
  return before + first(x, ...list);
}
async function* steps(x, p) {
  yield first(x, ...(await p));
  yield first(x, ...(yield x));
}
const arrow = async (x, p) => first(x, ...(await p));
const pair = () => Promise.resolve([2, 3]);
console.log(await one(1, pair()), await one(1, new Set([4, 5])), await two(1, pair(), pair()), await nested(1, pair()), await inLoop(1, pair()));
console.log(await caught(1, Promise.resolve(5)), await caught(1, Promise.reject(new RangeError("no"))), await behind(1, [6, 7], pair()), await arrow(1, "ab"));
const generator = steps(1, pair());
console.log((await generator.next()).value, (await generator.next()).value, (await generator.next([8, 9])).value);
