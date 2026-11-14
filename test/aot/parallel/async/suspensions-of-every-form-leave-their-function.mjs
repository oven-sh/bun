// A suspension leaves its function from the site: awaits of values, promises, thenables and calls, steps of async generators, yields, module bodies; with many live values, in handlers, under callers that go on.
const log = [];
const later = value => new Promise(resolve => queueMicrotask(() => resolve(value)));
const fails = text => new Promise((_, reject) => queueMicrotask(() => reject(new Error(text))));
const thenable = value => ({ then(resolve) { queueMicrotask(() => resolve(value)); } });
async function plain(value) {
  log.push("in " + value);
  const first = await later(value);
  log.push("out " + first);
  return first + 1;
}
async function settled(value) {
  const a = await value, b = await Promise.resolve(a), c = await null;
  return [a, b, c].join();
}
async function live(seed) {
  let a = seed, b = seed * 1.5, c = "s" + seed, d = { seed }, e = [seed], f = BigInt(seed), g = seed > 3, h = seed | 0, i = -seed, j = seed / 3;
  for (let round = 0; round < 3; round++) {
    a += await later(round);
    b *= await 2;
    c += await thenable("t" + round);
    d = { seed: d.seed + (await plain(round)) };
    e.push(await settled(round));
    f += BigInt(await later(round));
    j += h + i;
  }
  return [a, b, c, d.seed, e.join("/"), f, g, h, i, j].join(" ");
}
async function handlers(seed) {
  let text = "";
  for (const form of [later, fails]) {
    try {
      text += await form(seed + form.name);
    } catch (error) {
      text += "caught " + error.message + (await later("+"));
    } finally {
      text += await plain(seed);
      try {
        await fails("inner");
      } catch {
        text += await settled(seed);
      }
    }
  }
  return text;
}
async function deep(depth) {
  return depth ? (await deep(depth - 1)) + (depth % 3 ? await depth : await later(depth)) : await later(0);
}
async function* steps(limit) {
  try {
    for (let index = 0; index < limit; index++) {
      const sent = yield index % 2 ? await later(index) : index;
      if (sent) log.push("sent " + sent);
    }
    yield* inner(limit);
    return await plain("end");
  } finally {
    log.push("finally " + (await later(limit)));
  }
}
async function* inner(limit) {
  yield await settled(limit);
  yield Promise.resolve("p" + limit);
  await null;
}
function* walk(limit, f) {
  const held = { limit }, half = limit / 2;
  for (let index = 0; index < limit; index++) {
    try {
      const sent = yield f ? f(index + half) : index + held.limit;
      if (sent) log.push("walk " + sent);
    } catch (error) {
      log.push("thrown " + error);
      yield* walk(index, f);
    }
  }
  return held;
}
async function consume(limit) {
  let text = "";
  for await (const value of steps(limit)) text += value + ";";
  for await (const value of steps(limit)) {
    text += value;
    if (value === 1) break;
  }
  for await (const value of [later("x"), 1, "y"]) text += value;
  for await (const value of walk(3)) text += value;
  const generator = steps(2);
  text += JSON.stringify([await generator.next(), await generator.next("s"), await generator.return("r"), await generator.next()]);
  try {
    const thrown = steps(2);
    await thrown.next();
    await thrown.throw(new Error("into"));
  } catch (error) {
    text += error.message;
  }
  return text;
}
function starts(count) {
  const promises = [];
  for (let index = 0; index < count; index++) promises.push(plain(index), settled(index), deep(index % 5));
  log.push("started " + promises.length);
  return promises;
}
const callers = {
  arrow: async value => (await plain(value)) * 2,
  async method(value) {
    const { arrow } = this;
    return [await arrow(value), await Promise.all(starts(2)), await this.method2?.(value)].join();
  },
  async method2(value) {
    return (await Promise.allSettled([fails("a"), later(value), handlers(value)])).map(entry => entry.status).join();
  },
};
console.log(await live(2), "|", await live(5));
console.log(await handlers(1));
console.log(await deep(12), await deep(0));
console.log(await consume(4));
console.log(await callers.method(3));
console.log((await Promise.all(starts(6))).join(" "));
const walked = walk(4, value => value * 2), values = [];
for (let result = walked.next(), step = 0; !result.done && step < 12; step++) {
  values.push(result.value);
  result = step === 1 ? walked.throw("t") : walked.next(step % 3 && "n" + step);
}
console.log(values.join());
let total = 0;
for (let round = 0; round < 300; round++) {
  total += await plain(round);
  if (round % 2) total += (await settled(round)).length;
  for (const value of walk(3)) total += value;
  for await (const value of inner(round)) total += value.length;
}
console.log(total, log.length, log.slice(0, 60).join());
const late = plain("late");
setTimeout(async () => console.log("timer", await late, await live(1)), 0);
