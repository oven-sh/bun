// Async functions called through their own promises: every number of parameters, numbers in floating point registers, variables of outer functions, methods, recursion, throws before and behind the first await, and enough promises that the collector runs while arguments are in registers.
const lines = [];
const note = (...values) => lines.push(values.map(value => (typeof value === "object" && value !== null ? JSON.stringify(value) : String(value))).join(" "));

async function none() { await null; return "none"; }
async function one(a) { await null; return [a]; }
async function two(a, b) { await null; return [a, b]; }
async function three(a, b, c) { await null; return [a, b, c]; }
async function four(a, b, c, d) { await null; return [a, b, c, d]; }
async function five(a, b, c, d, e) { await null; return [a, b, c, d, e]; }
async function six(a, b, c, d, e, f) { await null; return [a, b, c, d, e, f]; }
async function seven(a, b, c, d, e, f, g) { await null; return [a, b, c, d, e, f, g]; }
async function eight(a, b, c, d, e, f, g, h) { await null; return [a, b, c, d, e, f, g, h]; }
async function many(a, b, c, d, e, f, g, h, i, j, k) { await null; return [a, b, c, d, e, f, g, h, i, j, k]; }
async function rest(a, ...others) { await null; return [a, others]; }
async function defaults(a = 1, b = a + 1, { c = b + 1 } = {}) { await null; return [a, b, c]; }
async function half(x) { const y = x * 0.5; await null; return y; }
async function weighted(x, y, z) { const sum = x * 0.5 + y * 0.25 + z * 0.125; await null; return sum + x; }
const functions = [none, one, two, three, four, five, six, seven, eight, many, rest, defaults];

class Counter {
  #total = 0;
  constructor(step) { this.step = step; }
  async add(by) { this.#total += by * this.step; await null; return this.#total; }
  async get() { await null; return this.#total; }
  static async make(step) { await null; return new Counter(step); }
}

function outer(prefix) {
  let calls = 0;
  const inner = async (suffix, n) => {
    calls++;
    const mine = calls;
    await null;
    return `${prefix}${suffix}${n}/${mine}`;
  };
  const plain = async () => { calls += 10; await null; return calls; };
  return { inner, plain };
}

async function down(n, text) { if (n === 0) return text; const given = await down(n - 1, text + (n % 10)); return given; }
async function throwsAtOnce(x) { if (x) throw new Error("at once " + x); await null; return "kept"; }
async function throwsLater(x) { await null; if (x) throw new Error("later " + x); return "kept"; }
async function throwsInParameter(a = (() => { throw new Error("in a parameter"); })()) { await null; return a; }

const arguments_ = index => [index, "t" + index, index + 0.5, { index }, [index], null, index % 2 === 0, undefined, BigInt(index), -index, "z"];

for (const called of functions) {
  const given = arguments_(functions.indexOf(called) + 1);
  const result = called(...given);
  note(called.name, called.length, result instanceof Promise, JSON.stringify(await result, (key, value) => (typeof value === "bigint" ? value + "n" : value === undefined ? "undefined" : value)));
}
note(await half(3), await weighted(1, 2, 3), await weighted(0.5, 0.25, -0));

const counter = await Counter.make(3);
note(await Promise.all([counter.add(1), counter.add(2), counter.add(3), counter.get()]));
const { inner, plain } = outer("p");
note(await Promise.all([inner("a", 1), plain(), inner("b", 2), inner("c", 3)]));
note((await down(200, "")).length);
for (const [name, call] of Object.entries({ throwsAtOnce, throwsLater, throwsInParameter })) {
  let threw = "no";
  let promise;
  try { promise = call(name === "throwsInParameter" ? undefined : 1); } catch (error) { threw = error.message; }
  note(name, threw, promise instanceof Promise, await promise.then(value => "kept " + value, error => error.message));
}
note(await throwsAtOnce(0), await throwsLater(0));

// The arguments are the only references to new objects while promises are made.
let wrong = 0;
const pending = [];
for (let index = 0; index < 20000; index++) {
  const object = { index, text: "o" + index };
  pending.push(two(object, [index]), four("s" + index, { index }, index * 0.5, [object]), five({ a: index }, { b: index }, { c: index }, { d: index }, { e: index }));
  if (pending.length >= 3000) {
    const results = await Promise.all(pending.splice(0));
    for (let place = 0; place < results.length; place += 3) {
      const [[first, list], [text, holder, number, objects], many] = [results[place], results[place + 1], results[place + 2]];
      const of = first.index;
      if (first.text !== "o" + of || list[0] !== of || text !== "s" + of || holder.index !== of || number !== of * 0.5 || objects[0] !== first) wrong++;
      if (many.map(value => Object.keys(value)[0]).join("") !== "abcde" || many.some(value => Object.values(value)[0] !== of)) wrong++;
    }
  }
}
note("wrong", wrong, pending.length);

function sumOfWeights(count) {
  const all = [];
  for (let index = 0; index < count; index++) all.push(weighted(index, index * 2, index * 4));
  return Promise.all(all).then(values => values.reduce((a, b) => a + b, 0));
}
note(await sumOfWeights(20000));

// At the end of the stack the call throws or its promise rejects, and either way the caller goes on.
function deep(n) {
  try {
    return deep(n + 1) ?? null;
  } catch {
    try { two(n, n).catch(() => {}); } catch {}
    return "ended";
  }
}
note(deep(0));
note(await two("after", "the end of the stack"));

const stack = await (async function thrower() { return new Error("traced").stack; })();
note(stack.split("\n").slice(0, 2).map(line => line.replace(/\(?\S*[/\\].*$/, "").trim()).join("|"));
console.log(lines.join("\n"));
