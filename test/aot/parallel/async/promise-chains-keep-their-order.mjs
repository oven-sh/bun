import { AsyncLocalStorage } from "node:async_hooks";

const out = [];
const log = text => out.push(text);
const nothing = () => Promise.resolve(undefined);
const resolvers = [];
const pending = value => new Promise(resolve => resolvers.push(() => resolve(value)));
const immediate = () => new Promise(resolve => setImmediate(resolve));

async function settle() {
  for (let turn = 0; turn < 12; turn++) {
    await immediate();
    for (const resolve of resolvers.splice(0)) resolve();
  }
}

function ticks(name, count) {
  let promise = Promise.resolve();
  for (let tick = 0; tick < count; tick++) promise = promise.then(() => void log(`${name}${tick}`));
  return promise;
}

// A handler that returns a promise takes three jobs, one that returns a value takes one.
async function returnedPromises() {
  ticks("t", 12);
  nothing()
    .then(() => (log("a"), nothing()))
    .then(() => (log("b"), Promise.resolve(1)))
    .then(value => (log("c" + value), value + 1))
    .then(value => (log("d" + value), pending(value + 1)))
    .then(value => (log("e" + value), Promise.resolve(value).then(inner => Promise.resolve(inner + 1))))
    .then(value => log("f" + value))
    .catch(() => log("no"));
  await settle();
}

async function rejections() {
  ticks("r", 8);
  nothing()
    .then(() => Promise.reject(new Error("one")))
    .then(() => log("no"), error => (log("caught " + error.message), nothing()))
    .then(() => {
      throw new Error("two");
    })
    .catch(error => (log("caught " + error.message), Promise.reject(new Error("three"))))
    .finally(() => (log("finally"), nothing()))
    .catch(error => log("caught " + error.message));
  nothing().catch(() => log("no")).catch(() => log("no")).then(() => log("past two handlers"));
  const self = immediate().then(() => self);
  self.catch(error => log(error.constructor.name));
  await settle();
}

async function otherPromises() {
  class Mine extends Promise {}
  const own = Promise.resolve("own");
  own.then = function (resolve, reject) {
    log("own then");
    return Promise.prototype.then.call(this, resolve, reject);
  };
  const extra = Object.assign(Promise.resolve("extra"), { kept: 1 });
  ticks("o", 10);
  nothing().then(() => Mine.resolve("mine")).then(log);
  nothing().then(() => own).then(log);
  nothing().then(() => extra).then(log);
  nothing().then(() => Object.freeze(Promise.resolve("frozen"))).then(log);
  nothing().then(() => ({ then: resolve => (log("thenable"), resolve("from thenable")) })).then(log);
  nothing().then(() => Promise.all([nothing(), pending("all"), 1])).then(list => log(list.join()));
  nothing().then(() => Promise.race([pending("slow"), immediate().then(() => "race")])).then(log);
  nothing().then(() => Promise.allSettled([Promise.reject(1), pending(2)])).then(list => log(list.map(entry => entry.status).join()));
  nothing().then(() => Promise.any([Promise.reject(1), pending("any")])).then(log);
  (async () => {
    log(await nothing().then(() => pending("awaited")));
  })();
  (async function* () {
    yield* [nothing().then(() => "yielded")];
  })().next().then(step => log(step.value));
  await settle();
}

async function contexts() {
  const store = new AsyncLocalStorage();
  for (const name of ["x", "y"]) {
    store.run(name, () => {
      nothing()
        .then(() => (log(name + store.getStore()), nothing()))
        .then(() => (log(name + store.getStore()), pending(1)))
        .then(() => (log(name + store.getStore()), store.run("inner", () => nothing().then(() => log(store.getStore())))))
        .then(() => log(name + store.getStore()));
    });
  }
  nothing().then(() => nothing()).then(() => log(String(store.getStore())));
  await settle();
}

// Most of these promises are older than the collection that runs while they settle.
async function manyChains() {
  let sum = 0;
  const chain = value =>
    nothing()
      .then(() => pending({ value }))
      .then(box => (box.value % 3 ? Promise.resolve(box) : Promise.resolve(box).then(same => same)))
      .then(box => nothing().then(() => box.value))
      .then(number => (number % 5 ? number : Promise.reject(number)))
      .catch(number => Promise.resolve(number * 2))
      .then(number => void (sum += number));
  const chains = [];
  for (let value = 0; value < 4000; value++) chains.push(chain(value));
  for (let turn = 0; turn < 4; turn++) {
    const garbage = [];
    for (let index = 0; index < 20000; index++) garbage.push({ index, text: "g" + index });
    globalThis.kept = garbage.length;
    await settle();
  }
  const all = await Promise.all(chains);
  log(`${sum} ${all.length} ${all.every(value => value === undefined)}`);
}

for (const part of [returnedPromises, rejections, otherPromises, contexts, manyChains]) {
  log("-- " + part.name);
  await part();
}
console.log(out.join("\n"));
