import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(String(text));
const storage = new AsyncLocalStorage();
const show = value =>
  value === null || typeof value !== "object" ? `${typeof value} ${Object.is(value, -0) ? "-0" : String(value)}` : value instanceof Promise ? "promise" : `{${Object.keys(value)}}`;

const never = async value => value;
const soon = async value => (await null, value);
const fails = async value => {
  throw new Error("fails " + String(value));
};
const wrap = value => Promise.resolve(value);
const deep = (value, depth) => (depth ? deep(value, depth - 1) : wrap(value));
class Mine extends Promise {}
const holder = {
  give: value => Promise.resolve(value),
  async never(value) {
    return value;
  },
  get property() {
    return wrap;
  },
};
const thenable = value => ({ then: resolve => (log("thenable"), resolve(value)) });
const kept = Promise.resolve("kept");
const ownThen = Promise.resolve("own");
ownThen.then = function (onFulfilled, onRejected) {
  log("own then");
  return Promise.prototype.then.call(this, onFulfilled, onRejected);
};

const values = [undefined, null, -0, NaN, 2 ** 53, "text", "ro".repeat(2) + "pe", 10n ** 20n, Symbol.for("symbol"), true, { a: 1 }, [1], Object.freeze({ frozen: 1 }), { then: 5 }, () => 1, kept, Mine.resolve("mine"), ownThen, thenable("inner"), Object.create(null)];
const handlers = {
  resolve: value => Promise.resolve(value),
  empty: () => Promise.resolve(),
  wrap: value => wrap(value),
  itself: wrap,
  deep: value => deep(value, 3),
  never: value => never(value),
  neverItself: never,
  async: async value => value,
  asyncLate: async value => (await null, value),
  asyncOfPromise: async value => wrap(value),
  soon: value => soon(value),
  fails: value => fails(value),
  throws: () => {
    throw new Error("throws");
  },
  method: value => holder.give(value),
  methodNever: value => holder.never(value),
  getter: value => holder.property(value),
  apply: value => Reflect.apply(wrap, undefined, [value]),
  call: value => wrap.call(null, value),
  bound: wrap.bind(null),
  boundResolve: Promise.resolve.bind(Promise),
  mine: value => Mine.resolve(value),
  nested: value => Promise.resolve(Promise.resolve(value)),
  notTail: value => {
    const promise = wrap(value);
    log("is " + show(promise));
    return promise;
  },
  final: value => {
    try {
      return wrap(value);
    } finally {
      log("final");
    }
  },
  conditional: value => (value ? wrap(value) : never(value)),
  constructed: value => new Promise(resolve => resolve(value)),
  chained: value => wrap(value).then(inner => wrap(inner)),
  all: value => Promise.all([value, wrap(1)]),
  kept: () => kept,
  sloppy: Function("value", "return Promise.resolve(value)"),
};

async function ticks(name, count) {
  for (let tick = 0; tick < count; tick++) {
    log(name + tick);
    await null;
  }
}
async function quiet(count) {
  for (let tick = 0; tick < count; tick++) await null;
}
process.on("unhandledRejection", error => log("unhandled " + error?.message));
process.on("rejectionHandled", () => log("handled"));

for (const name of Object.keys(handlers)) {
  const handler = handlers[name];
  for (const waiting of [0, 20]) {
    log(`-- ${name} ${waiting}`);
    for (let k = 0; k < waiting; k++) void quiet(8 + (k % 3));
    for (const value of values) {
      const beside = ticks("t", 7);
      await Promise.resolve(value)
        .then(handler)
        .then(
          result => log("then " + show(result)),
          error => log("else " + error.message),
        );
      await beside;
    }
    const beside = ticks("u", 9);
    const results = [
      Promise.reject(new Error("first")).catch(() => handler("caught")),
      wrap(1).finally(() => handler("ignored")),
      wrap(2).then(handler).then(handler).then(handler),
      storage.run("context", () =>
        wrap(3)
          .then(handler)
          .then(() => storage.getStore()),
      ),
      new Promise((resolve, reject) =>
        queueMicrotask(() => {
          try {
            resolve(handler("later"));
          } catch (error) {
            reject(error);
          }
        }),
      ),
      never("awaited").then(handler),
    ];
    if (name !== "throws") queueMicrotask(() => void handler("dropped")?.catch?.(() => {}));
    for (const one of await Promise.allSettled(results)) log(one.status + " " + (one.status === "fulfilled" ? show(one.value) : one.reason.message));
    await beside;
    await new Promise(resolve => setImmediate(resolve));
  }
}

let sum = 0;
for (let round = 0; round < 10; round++) {
  const chains = [];
  for (let k = 0; k < 1000; k++)
    chains.push(
      wrap(k)
        .then(value => wrap(value + 1))
        .then(value => never({ value }))
        .then(object => wrap(object.value)),
    );
  for (const value of await Promise.all(chains)) sum += value;
}
log(sum);
console.log(out.join("\n"));
