function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function* counter(limit) {
  let i = 0;
  while (i < limit) {
    const step = yield i;
    i += step ?? 1;
  }
  return i;
}

function* accumulator() {
  let total = 0;
  let bits = 0;
  for (;;) {
    const value = yield [total, bits];
    total += value;
    bits |= value;
  }
}

function* indexer(list) {
  let index = 0;
  for (;;) {
    const next = yield list[index];
    index = next;
    index++;
  }
}

function drive(generator, sent) {
  const seen = [generator.next().value];
  for (const value of sent) {
    const result = generator.next(value);
    seen.push(result.value);
    if (result.done) break;
  }
  return seen;
}

async function sumOfAwaited(values) {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += await values[i];
  return total;
}

async function countAcrossAwaits(value) {
  let count = 0;
  count++;
  count = await value;
  count++;
  await null;
  return [count, count | 0, typeof count];
}

async function* ticks(steps) {
  let at = 0;
  for (const step of steps) {
    at += step;
    yield at;
  }
}

async function collect(iterable) {
  const seen = [];
  for await (const value of iterable) seen.push(value);
  return seen;
}

async function attemptAsync(label, run) {
  try {
    console.log(label, "->", show(await run()));
  } catch (error) {
    console.log(label, "-> threw", error.constructor.name);
  }
}

for (let i = 0; i < 500; i++) {
  drive(counter(5), [1, 2, 1]);
  drive(accumulator(), [1, 2, 3]);
  drive(indexer(["a", "b", "c"]), [0, 1]);
}

const sent = [2, "2", 0.5, -0, null, undefined, true, 2n, NaN, [1], { valueOf: () => 2 }, 2147483647, Symbol("s")];
for (const value of sent) {
  attempt("counter gets " + show(value), () => drive(counter(8), [1, value, 1, 1]));
  attempt("accumulator gets " + show(value), () => drive(accumulator(), [1, value, 1]));
  attempt("indexer gets " + show(value), () => drive(indexer(["a", "b", "c", "d"]), [0, value, 0]));
}

async function main() {
  for (let i = 0; i < 200; i++) {
    await sumOfAwaited([1, 2]);
    await countAcrossAwaits(i);
  }
  for (const value of sent) {
    await attemptAsync("sumOfAwaited with " + show(value), () => sumOfAwaited([1, value, Promise.resolve(value), 1]));
    await attemptAsync("countAcrossAwaits " + show(value), () => countAcrossAwaits(value));
    await attemptAsync("countAcrossAwaits a promise of " + show(value), () => countAcrossAwaits(Promise.resolve(value)));
    await attemptAsync("ticks with " + show(value), () => collect(ticks([1, value, 1])));
  }
  await attemptAsync("a thenable", () => countAcrossAwaits({ then: resolve => resolve("7") }));
}

main();
