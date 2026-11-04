// A coroutine hands its caller a generator or a promise, so what it returns and yields stays boxed, whatever is proven of it. What it calls may return raw.
const report = value =>
  console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value));
function told(n) {
  report(n);
  report(n + 1);
  report(n * 2);
  report(n === n);
  report(typeof n);
}
function half(n) {
  return n / 2;
}
function bits(n) {
  return n | 0;
}
function isBig(n) {
  return n > 2;
}
function* halves(n) {
  while (n > 1) {
    n = half(n);
    yield n;
  }
  return bits(n * 100);
}
function* flags(list) {
  for (const n of list) yield isBig(n);
  return list.length > 2;
}
function* echoed() {
  let sum = 0;
  for (;;) {
    const sent = yield sum;
    if (sent === undefined) return sum > 3;
    sum += half(sent);
  }
}
function* onlyReturns() {
  return 1.5;
}
function* delegates() {
  const last = yield* halves(5);
  yield last + 0.5;
  return yield* onlyReturns();
}
function sumOf(iterable) {
  let sum = 0;
  for (const n of iterable) sum += n;
  return sum;
}
function countTrue(iterable) {
  let count = 0;
  for (const flag of iterable) if (flag) count++;
  return count;
}
report(typeof halves(4));
report([...halves(10)].join());
told(sumOf(halves(10)));
told(countTrue(flags([1, 3, 5])));
const stepped = halves(3);
for (let step = stepped.next(); ; step = stepped.next()) {
  told(step.value);
  report(step.done);
  if (step.done) break;
}
const talks = echoed();
told(talks.next().value);
told(talks.next(3).value);
told(talks.next(5).value);
told(talks.next().value);
told(onlyReturns().next().value);
report([...delegates()].join());
const left = halves(100);
left.next();
told(left.return(7.5).value);

async function later(n) {
  return half(n);
}
async function laterFlag(n) {
  return isBig(n);
}
async function laterBits(n) {
  await null;
  return bits(n);
}
async function sum(a, b) {
  return (await later(a)) + (await laterBits(b));
}
async function* ticks(n) {
  for (let i = 0; i < n; i++) yield half(i);
  return n;
}
const arrowLater = async n => n * 2;
class Source {
  async size() {
    return 4.5;
  }
  *[Symbol.iterator]() {
    yield 1;
    yield 2.5;
  }
  get ready() {
    return later(8);
  }
}
report(typeof later(1));
report(later(1) instanceof Promise);
told(await later(5));
told(await laterFlag(5));
told(await laterBits(5.5));
told(await sum(3, 4.5));
told(await arrowLater(1.5));
told(await new Source().size());
told(await new Source().ready);
told(sumOf(new Source()));
let ticked = 0;
for await (const tick of ticks(4)) ticked += tick;
told(ticked);
report((await Promise.all([later(1), laterFlag(1), laterBits(1.5)])).join());
told(await half(9));
told(await isBig(9));
