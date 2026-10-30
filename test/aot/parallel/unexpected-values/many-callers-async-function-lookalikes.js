// Many callers of an async function and an lookalikes.
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

async function total(list) {
  await null;
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

async function double(n) {
  const before = n * 2;
  await null;
  return before + n;
}

async function span(point) {
  const x = point.x;
  await null;
  return x - point.y;
}

async function twice(promise) {
  const value = await promise;
  return value * 2;
}

async function shout(text) {
  await null;
  return text.toUpperCase();
}

async function honest(round) {
  console.log(round, "total", await total([1, 2, 3]), await total([]), await total(new Array(4, 5)), await total([0.5]), await total(Array.of(6)));
  console.log(round, "double", await double(1), await double(2.5), await double(-3), await double(0));
  console.log(round, "span", await span({ x: 3, y: 1 }), await span({ x: 0.5, y: 0.25 }), await span({ x: 9, y: 4 }));
  console.log(round, "twice", await twice(Promise.resolve(1)), await twice(Promise.resolve(2.5)), await twice(new Promise(resolve => resolve(3))));
  console.log(round, "shout", await shout("abc"), await shout(""), await shout(round));
}

const notLists = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["holes", () => new Array(2)],
  ["null", () => null],
];

const notNumbers = [
  ["a numeric string", () => "3"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["a BigInt", () => 3n],
  ["negative zero", () => -0],
  ["undefined", () => undefined],
];

const notPromises = [
  ["a number", () => 3],
  ["a promise of a string", () => Promise.resolve("3")],
  ["a promise of a BigInt", () => Promise.resolve(3n)],
  ["a promise of undefined", () => Promise.resolve()],
  ["a thenable", () => ({ then(resolve) { log.push("then"); resolve(3); } })],
  ["a thenable that answers a string", () => ({ then(resolve) { log.push("then"); resolve("3"); } })],
  ["a thenable that answers a thenable", () => ({ then(resolve) { log.push("outer"); resolve({ then(again) { log.push("inner"); again(4); } }); } })],
  ["a thenable that rejects", () => ({ then(resolve, reject) { reject(new RangeError("no")); } })],
  ["a thenable that throws", () => ({ then() { throw new SyntaxError("no"); } })],
  ["an object whose then is a getter", () => ({ get then() { log.push("get then"); return undefined; }, valueOf: () => 5 })],
  ["an object whose then is not a function", () => ({ then: 5, valueOf: () => 6 })],
  ["a rejected promise", () => Promise.reject(new EvalError("no"))],
  ["null", () => null],
];

async function main() {
  await honest("before");
  for (const [name, make] of notLists) {
    await attempt("total of " + name, () => total(make()));
    await attempt("total through call of " + name, () => total.call(null, make()));
    await attempt("total as a reaction to " + name, () => Promise.resolve([make()]).then(([value]) => value).then(total));
  }
  for (const [name, make] of notNumbers) {
    await attempt("double of " + name, () => double(make()));
    await attempt("double as a callback of " + name, () => Promise.all([make()].map(double)).then(([value]) => value));
    await attempt("double from hidden code of " + name, () => new Function("f", "value", "return f(value)")(double, make()));
  }
  for (const [name, make] of notPromises) await attempt("twice of " + name, () => twice(make()));

  await attempt("a point whose y changes during the wait", () => {
    const point = { x: 3, y: 1 };
    const result = span(point);
    point.y = "2";
    return result;
  });
  await attempt("a point whose y is deleted during the wait", () => {
    const point = { x: 3, y: 1 };
    const result = span(point);
    delete point.y;
    return result;
  });
  await attempt("a point that gets a getter during the wait", () => {
    const point = { x: 3, y: 1 };
    const result = span(point);
    Object.defineProperty(point, "y", { get: () => (log.push("get y"), 2) });
    return result;
  });
  await attempt("a list that shrinks during the wait", () => {
    const list = [1, 2, 3];
    const result = total(list);
    list.length = 1;
    return result;
  });
  await attempt("a list that gets a string during the wait", () => {
    const list = [1, 2, 3];
    const result = total(list);
    list[1] = "2";
    return result;
  });
  await attempt("shout of an array", () => shout(["a"]));
  await attempt("shout of an object with the method", () => shout({ toUpperCase: () => 5 }));
  await attempt("what an async function answers is a promise", async () => [total([]) instanceof Promise, typeof double(1).then, (double(1) * 2)]);
  await honest("after");
}

main();
