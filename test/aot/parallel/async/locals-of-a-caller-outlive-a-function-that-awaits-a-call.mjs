// A function holds maps and sets across calls, reads them no more and awaits what a call returns. The locals of whoever called it are what they were when it comes back,
// and so are its own when it goes on, whichever way the awaited function is called: by name, as a value, as a method, in a try, in a loop.
let total = 0;
const timer = () => new Promise(resolve => setTimeout(resolve, 0));
async function leaf(n) {
  await null;
  return n + 1;
}
async function leafThatWaits(n) {
  await timer();
  return n + 2;
}
async function leafThatFinishesAtOnce(n) {
  return n + 3;
}
async function leafThatThrows(n) {
  await null;
  throw new Error("thrown " + n);
}
const leaves = { leaf, leafThatWaits, leafThatFinishesAtOnce };
const listOfLeaves = [leaf, leafThatWaits, leafThatFinishesAtOnce];
function hold(n) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size + c.size;
  return [a, b, c];
}
async function byName(n) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size + c.size;
  return await leaf(n);
}
async function byNameAndGoesOn(n) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size;
  const r = await leafThatWaits(n);
  return r + a.get(n) + [...b][0] + c.size;
}
async function asValue(n, f) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size + c.size;
  return await f(n);
}
async function asMethod(n, holder) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size + c.size;
  return await holder.leafThatWaits(n);
}
async function inTry(n) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  const c = new Map([[n, b]]);
  total += a.size + b.size;
  try {
    return await leafThatThrows(n);
  } catch (error) {
    return error.message + a.get(n) + c.size;
  } finally {
    total += b.size;
  }
}
async function inLoop(n) {
  const a = new Map([[n, "a" + n]]);
  const b = new Set(["b" + n]);
  let sum = "";
  for (const f of listOfLeaves) {
    const c = new Map([[n, b]]);
    total += c.size;
    sum += await f(n);
    sum += await leaf(n);
  }
  return sum + a.get(n) + b.size;
}
async function chain(n) {
  const [a, b, c] = hold(n);
  const r = await byNameAndGoesOn(n);
  const s = await asValue(n, byName);
  return r + s + a.get(n) + b.size + c.size;
}
function callsByName(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = byName(n);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsByNameAndGoesOn(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = byNameAndGoesOn(n);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsAsValue(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = asValue(n, listOfLeaves[n % 3]);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsAsMethod(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = asMethod(n, leaves);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsInTry(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = inTry(n);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsInLoop(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = inLoop(n);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
function callsChain(n) {
  const [a, b, c] = hold(n);
  const d = "d" + n;
  const promise = chain(n);
  return [a.get(n), [...b][0], c.get(n) === b, d, promise];
}
const callers = [callsByName, callsByNameAndGoesOn, callsAsValue, callsAsMethod, callsInTry, callsInLoop, callsChain];
for (let n = 0; n < 4; n++) {
  for (const caller of callers) {
    const [a, b, c, d, promise] = caller(n);
    console.log(caller.name, a, b, c, d, await promise);
  }
}
const together = await Promise.all(
  callers.map(caller => {
    const [a, b, c, d, promise] = caller(9);
    return promise.then(value => [a, b, c, d, value].join(" "));
  }),
);
console.log(together.join("\n"));
console.log(total);
