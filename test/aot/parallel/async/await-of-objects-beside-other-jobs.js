// An await of an object without a `then` takes one turn, like an await of a primitive: alone, among the jobs of then() handlers and of other awaits, and while the collector runs with nothing but
// a queued job holding on to the object. An object that has a `then`, gets one, inherits one, answers for one through a getter or a proxy is asked for it every time.
const settled = Promise.resolve();
const lines = [];
let log = [];
const named = (...parts) => parts.join("");

class Point {
  constructor(x) {
    this.x = x;
  }
}
class Listed extends Array {}
function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (value instanceof Map) return "Map(" + value.size + ")";
  if (value instanceof Error) return "Error " + value.message;
  if (value instanceof RegExp || value instanceof URL) return String(value);
  if (value instanceof Date) return "Date " + value.getTime();
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

async function awaitsSame(label, value, steps) {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await value));
}
async function awaitsNew(label, make, steps) {
  for (let i = 0; i < steps; i++) log.push(label + " " + show(await make(i)));
}
async function awaitsWhatComes(label, values) {
  for (const value of values) log.push(label + " " + show(await value));
}
function thenChain(label, steps) {
  let done = 0;
  const step = () => {
    log.push(label + " " + done);
    if (++done < steps) settled.then(step);
  };
  settled.then(step);
}

function adopt(label) {
  return function (resolve) {
    log.push("then of " + label);
    resolve("adopted from " + label);
  };
}
const tagged = new Point(7);
tagged[named("t", "ag")] = 1;
const emptied = new Point(8);
emptied[named("t", "ag")] = 1;
delete emptied[named("t", "ag")];
const withoutPrototype = Object.create(null);
withoutPrototype.bare = true;
const withNumber = { then: 5 };
const ownThen = { then: adopt("own") };
const inheritedThen = Object.create({ then: adopt("inherited") });
const getterThen = {
  get then() {
    log.push("getter of then");
    return undefined;
  },
};
const proxied = new Proxy(
  { inside: 1 },
  {
    get(target, key) {
      if (key === "then") log.push("proxy asked for then");
      return target[key];
    },
  },
);

async function everyKindTogether() {
  log = [];
  const all = [awaitsSame("literal", { a: 1 }, 4), awaitsNew("new literal", i => ({ i }), 3), awaitsSame("instance", new Point(1), 4)];
  thenChain("then", 6);
  all.push(awaitsNew("new instance", i => new Point(i), 3), awaitsSame("array", [1, 2], 3), awaitsSame("subclass of Array", Listed.of(3), 2), awaitsSame("function", show, 3));
  all.push(awaitsSame("tagged", tagged, 3), awaitsSame("emptied", emptied, 3), awaitsSame("frozen", Object.freeze({ f: 1 }), 2), awaitsSame("no prototype", withoutPrototype, 3));
  thenChain("second then", 4);
  all.push(awaitsWhatComes("what comes", [{ a: 1 }, 1, new Point(2), "two", [3], null, new Map([[1, 2]]), new Error("four"), /five/g, new Date(6), new URL("http://seven/"), withNumber, show, tagged]));
  all.push(awaitsWhatComes("thenables", [ownThen, { a: 1 }, inheritedThen, new Point(3), getterThen, proxied, ownThen, settled, Promise.resolve({ p: 1 })]));
  log.push("all have begun");
  await Promise.all(all);
  lines.push("== every kind together", ...log);
}

async function thenComesAndGoes() {
  log = [];
  const point = new Point(1);
  const literal = { a: 1 };
  for (const value of [point, literal]) {
    thenChain("then", 3);
    await awaitsSame("before", value, 3);
    value[named("th", "en")] = adopt("late");
    await awaitsSame("with then", value, 2);
    delete value[named("th", "en")];
    await awaitsSame("after", value, 2);
  }
  Point.prototype[named("th", "en")] = adopt("the class");
  await awaitsSame("class with then", new Point(2), 2);
  await awaitsSame("literal beside it", literal, 2);
  delete Point.prototype[named("th", "en")];
  await awaitsSame("class without then", new Point(3), 2);
  lines.push("== then comes and goes", ...log);
}

const laps = {
  "one literal": async (id, steps, seen, shared) => {
    for (let step = 0; step < steps; step++) if ((await shared) === shared) seen.push(id);
  },
  "new literals": async (id, steps, seen) => {
    for (let step = 0; step < steps; step++) if ((await { step }).step === step) seen.push(id);
  },
  "new instances": async (id, steps, seen) => {
    for (let step = 0; step < steps; step++) if ((await new Point(step)).x === step) seen.push(id);
  },
  "new arrays": async (id, steps, seen) => {
    for (let step = 0; step < steps; step++) if ((await [step])[0] === step) seen.push(id);
  },
  "objects and numbers": async (id, steps, seen, shared) => {
    for (let step = 0; step < steps; step++) if ((await (step & 1 ? shared : step)) !== undefined) seen.push(id);
  },
};
// Every member takes one turn a step, so the members go on in the order in which they began, step after step.
async function population(label, size, steps) {
  const seen = [];
  const all = [];
  const shared = { shared: true };
  for (let id = 0; id < size; id++) all.push(laps[label](id, steps, seen, shared));
  let thens = 0;
  const byThen = () => {
    seen.push(size);
    if (++thens < steps) settled.then(byThen);
  };
  settled.then(byThen);
  await Promise.all(all);
  const members = size + 1;
  const inTurn = seen.length === members * steps && seen.every((id, index) => id === index % members);
  lines.push(label + ", " + size + " functions, " + steps + " steps: " + (inTurn ? "each in its turn" : "OUT OF TURN: " + seen.slice(0, 3 * members).join(" ")));
}

async function holds(id, steps) {
  let sum = 0;
  for (let step = 0; step < steps; step++) sum += (await { id, text: "held " + id, step }).text.length + step;
  return sum;
}
async function collections(size, steps) {
  const all = [];
  for (let id = 0; id < size; id++) {
    all.push(holds(id, steps));
    if (id === size >> 1) {
      let rounds = 0;
      const collects = () => {
        Bun.gc(true);
        if (++rounds < steps) settled.then(collects);
      };
      settled.then(collects);
    }
  }
  const sums = await Promise.all(all);
  lines.push(size + " objects that only queued jobs hold, with a collection in every round: " + sums.reduce((a, b) => a + b, 0));
}

await everyKindTogether();
await thenComesAndGoes();
lines.push("== in turn");
for (const label of Object.keys(laps)) {
  for (const size of [1, 2, 3, 7, 30, 100]) await population(label, size, 20);
  await population(label, 10, 2000);
}
lines.push("== alone");
log = [];
await awaitsSame("alone", { a: 1 }, 3);
await awaitsNew("alone", i => new Point(i), 3);
lines.push(...log);
lines.push("== collections");
await collections(1000, 4);
console.log(lines.join("\n"));
