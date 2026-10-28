// The order in which promise handlers, awaits, microtasks and ticks run. A round makes a few promises (fulfilled, rejected, pending, of a
// subclass, with a `then` or a `constructor` of its own, frozen, an async function's) and a thenable, then does 4 to 14 things with them:
// then, catch and finally with handlers of every kind, await, queueMicrotask, process.nextTick, Promise.all and race, a settle, a
// collection, some of it under a store of AsyncLocalStorage and some of it from inside another handler. Every step writes down its number,
// what it was handed and the store it runs under. The round runs 1 to 300 times, and the program prints each order it saw and how often.
import type { Random } from "./random";

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const cast = typed ? " as any" : "";
  let next = 0;
  const promises = [
    "fulfilled",
    "fulfilled",
    "fulfilled",
    "second",
    "rejected",
    "pending",
    "ofSubclass",
    "withOwnThen",
    "withOwnConstructor",
    "frozen",
    "ofAsyncFunction",
    "resolvedWithPromise",
  ];
  const promise = () => random.pick(promises);
  const returned = () =>
    random.pick(["undefined", "7", "fulfilled", "second", "pending", "thenable", "ofSubclass", `"text"`, "point"]);

  const body = (depth: number): string =>
    depth >= 3 || random.chance(0.55)
      ? ""
      : " " + Array.from({ length: random.between(1, 2) }, () => action(depth + 1)).join(" ");

  // A handler: an arrow function, a function shared by many calls, or something that cannot be called.
  const handler = (depth: number, cannotFail = false): string => {
    const n = next++;
    if (cannotFail)
      return random.chance(0.8) ? `(value${as("any")}) => { note("${n}", value);${body(depth)} }` : "shared";
    return random.weighted([
      [6, `(value${as("any")}) => { note("${n}", value);${body(depth)} }`],
      [2, `(value${as("any")}) => { note("${n}", value);${body(depth)} return ${returned()}; }`],
      [1, `(value${as("any")}) => { note("${n}", value); throw new Error("thrown by ${n}"); }`],
      [1, "shared"],
      [
        1,
        `async (value${as("any")}) => { note("${n}", value); await ${random.pick(["0", "fulfilled", "thenable"])}; note("${n} goes on", value);${body(depth)} }`,
      ],
      [1, random.pick(["undefined", "null", "5", `"text"`, "point"]) + cast],
    ]);
  };

  function action(depth: number): string {
    const n = next++;
    const p = promise();
    return random.weighted<() => string>([
      [8, () => `quiet(${p}.then(${handler(depth)}));`],
      // Nobody holds the promise that then() returns.
      [3, () => `fulfilled.then(${handler(depth, true)});`],
      [2, () => `quiet(${p}.then(${handler(depth)}, ${handler(depth)}));`],
      [2, () => `quiet(${p}.then(${handler(depth)}).then(${handler(depth)}));`],
      [1, () => `quiet(${p}.catch(${handler(depth)}));`],
      [1, () => `quiet(${p}.finally(() => { note("${n}", "finally");${body(depth)} }));`],
      [1, () => `quiet(Promise.prototype.then.call(${p}, ${handler(depth)}));`],
      [1, () => `quiet(Reflect.apply(Promise.prototype.then, ${p}, [${handler(depth)}]));`],
      [1, () => `quiet(${p}.then());`],
      [2, () => `queueMicrotask(() => { note("${n}", "microtask");${body(depth)} });`],
      [2, () => `process.nextTick(() => { note("${n}", "tick");${body(depth)} });`],
      [
        3,
        () =>
          `quiet((async () => { note("${n} starts", 0); const value = await ${random.pick([p, p, "thenable", "0", "point"])}; note("${n} goes on", value);${body(depth)} })());`,
      ],
      [
        1,
        () =>
          `quiet(Promise.${random.pick(["all", "allSettled", "race", "any"])}([${p}, ${promise()}, ${random.pick(["1", "thenable", "fulfilled"])}]).then(${handler(depth)}));`,
      ],
      [1, () => `quiet(Promise.resolve(${random.pick([p, "thenable", "point"])}).then(${handler(depth)}));`],
      [2, () => `settle(${random.pick(["round & 3", "fulfilled", "thenable", `"late"`])});`],
      [1, () => `fail(new Error("failed by ${n}"));`],
      [
        2,
        () =>
          `storage.run("store ${n}", () => { note("${n}", "run");${body(depth - 1 < 0 ? 0 : depth) || " " + action(depth + 1)} });`,
      ],
      [1, () => `kept.push(${p}.then(${handler(depth)})); quiet(kept[kept.length - 1]);`],
      [1, () => `if (round % 16 === 5) Bun.gc(true);`],
      [1, () => `if (round % 64 === ${random.between(1, 40)}) { note("${n}", "once");${body(depth)} }`],
    ])();
  }

  const rounds = random.pick([1, 2, 5, 30, 120, 300]);
  const actions = Array.from({ length: random.between(4, 14) }, () => "    " + action(0)).join("\n");
  return `import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage${typed ? "<string>" : ""}();
class Mine${typed ? "<T>" : ""} extends Promise${typed ? "<T>" : ""} {}
const point = { x: 1, y: 2 };
const show = (value${as("any")})${as("string")} =>
  value instanceof Error ? "Error " + value.message : value instanceof Promise ? "a promise" : Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : value !== null && typeof value === "object" ? "{" + Object.keys(value).join(" ") + "}" : String(value);
const quiet = (promise${as("any")}) => { promise.catch(() => {}); return promise; };
const seen = new Map${typed ? "<string, number>" : ""}();
const kept${as("any[]")} = [];

async function once(round${as("number")}) {
  const events${as("string[]")} = [];
  const note = (label${as("string")}, value${as("any")}) => { events.push(label + " " + show(value) + (storage.getStore() === undefined ? "" : " under " + storage.getStore())); };
  const shared = (value${as("any")}) => { note("shared", value); };
  const fulfilled${as("Promise<number>")} = Promise.resolve(round & 3);
  const second${as("Promise<string>")} = Promise.resolve("second");
  second.then(() => {});
  const rejected${as("Promise<any>")} = Promise.reject(new Error("rejected"));
  rejected.catch(() => {});
  const { promise: pending, resolve: settle, reject: fail } = Promise.withResolvers${typed ? "<any>" : ""}();
  pending.catch(() => {});
  const ofSubclass${as("Promise<number>")} = Mine.resolve(4);
  const withOwnThen${as("any")} = Promise.resolve(5);
  withOwnThen.then = function (${typed ? "this: any, " : ""}...handlers${as("any[]")}) { note("own then", handlers.length); return Promise.prototype.then.apply(this, handlers${cast}); };
  const withOwnConstructor${as("any")} = Promise.resolve(6);
  Object.defineProperty(withOwnConstructor, "constructor", { get() { note("constructor", "read"); return ${random.pick(["Promise", "Mine", "undefined"])}; } });
  const frozen${as("Promise<number>")} = Object.freeze(Promise.resolve(8));
  const ofAsyncFunction${as("Promise<number>")} = (async () => 9)();
  const resolvedWithPromise${as("Promise<any>")} = new Promise(resolve => resolve(fulfilled));
  const thenable${as("any")} = { then(done${as("any")}) { note("then of the thenable", typeof done); done(10); } };
  {
${actions}
  }
  note("synchronous", 0);
  await new Promise(done => setImmediate(done));
  await new Promise(done => setImmediate(done));
  const line = events.join(", ");
  seen.set(line, (seen.get(line) ?? 0) + 1);
  if (kept.length > 50) kept.length = 0;
}

for (let round = 0; round < ${rounds}; round++) await once(round);
for (const [line, count] of seen) console.log(count + " times: " + line);
`;
}
