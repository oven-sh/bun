function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

async function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(await run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

async function* plusOne(list) {
  for (const item of list) {
    await null;
    yield item + 1;
  }
}

async function* halves(source) {
  for await (const n of source) yield n / 2;
}

async function* adder() {
  let sum = 0;
  for (;;) sum += yield sum;
}

async function gather(iterable) {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function feed(generator, values) {
  const out = [(await generator.next()).value];
  for (const value of values) out.push((await generator.next(value)).value);
  return out;
}

async function honest(round) {
  console.log(round, "plusOne", show(await gather(plusOne([1, 2, 3]))), show(await gather(plusOne([]))), show(await gather(plusOne([0.5]))), show(await gather(plusOne(new Array(4, 5)))));
  console.log(round, "halves", show(await gather(halves([2, 4]))), show(await gather(halves(plusOne([1, 3])))), show(await gather(halves([Promise.resolve(8)]))));
  console.log(round, "adder", show(await feed(adder(), [1, 2, 3])), show(await feed(adder(), [0.5, 0.25])));
}

const sources = [
  ["a string", () => "12"],
  ["a Set of strings", () => new Set(["1", "2"])],
  ["an array of promises of strings", () => [Promise.resolve("4"), Promise.resolve("6")]],
  ["an array of thenables", () => [{ then(resolve) { log.push("then"); resolve(4); } }]],
  ["an array with a BigInt", () => [2, 4n]],
  ["holes", () => new Array(2)],
  ["a typed array", () => new Int8Array([-2, 4])],
  ["a generator", () => (function* () { yield 2; yield "4"; })()],
  ["an async iterator made by hand", () => ({ [Symbol.asyncIterator]() { let i = 0; return { next: () => (log.push("next"), Promise.resolve({ done: i++ > 1, value: "" + i })) }; } })],
  ["an async iterator whose next answers no promise", () => ({ [Symbol.asyncIterator]() { let i = 0; return { next: () => ({ done: i++ > 0, value: 8 }) }; } })],
  ["an array with a rejected promise", () => { const rejected = Promise.reject(new RangeError("no")); rejected.catch(() => {}); return [2, rejected]; }],
  ["an array-like object", () => ({ 0: 1, length: 1 })],
  ["a number", () => 5],
  ["null", () => null],
];

const sent = [
  ["a numeric string", () => "2"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 2) })],
  ["a BigInt", () => 2n],
  ["a promise", () => Promise.resolve(2)],
  ["undefined", () => undefined],
];

async function main() {
  await honest("before");
  for (const [name, make] of sources) {
    await attempt("plusOne of " + name, () => gather(plusOne(make())));
    await attempt("halves of " + name, () => gather(halves(make())));
    await attempt("halves through call of " + name, () => gather(halves.call(null, make())));
  }
  for (const [name, make] of sent) await attempt("adder is sent " + name, () => feed(adder(), [1, make(), 1]));
  await attempt("what it answers", async () => [typeof plusOne([]).next, plusOne([]).next() instanceof Promise, Symbol.asyncIterator in plusOne([]), Symbol.iterator in plusOne([])]);
  await attempt("spread of it", () => [...plusOne([1])]);
  await attempt("new on it", () => new plusOne([1]));
  await honest("after");
}

main();
