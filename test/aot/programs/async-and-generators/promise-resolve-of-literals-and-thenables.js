// Promise.resolve reads `then` of its argument at the call: literals with and without the member, and stores to it before and after.
function numberOrThenable(flag) {
  return Promise.resolve(flag ? 1 : { then(resolve) { resolve("from thenable"); } });
}

const shared = { v: 1 };
function install() { shared.then = function (resolve) { resolve("late"); }; }
async function awaited() { return typeof await Promise.resolve(shared); }

const steps = {
  [Symbol.asyncIterator]() {
    let i = 0;
    return { next() { return Promise.resolve({ done: i++ >= 2, value: "step " + i }); } };
  },
};

function overwritten(tag) {
  const holder = { then: undefined, v: tag };
  holder.then = function (resolve) { resolve("thenable " + tag); };
  const promise = Promise.resolve(holder);
  holder.then = undefined;
  return promise;
}

function storedLate(tag) {
  const holder = { then: undefined, v: tag };
  const promise = Promise.resolve(holder);
  holder.then = function (resolve) { resolve("thenable " + tag); };
  return promise;
}

function inherited(tag) {
  const base = { then: undefined };
  const heir = Object.create(base);
  base.then = function (resolve) { resolve("inherited " + tag); };
  const promise = Promise.resolve(heir);
  base.then = undefined;
  return promise;
}

let kept = null;
function escapedFirst(tag) {
  const holder = { then: undefined, v: tag };
  kept = holder;
  holder.then = function (resolve) { resolve("escaped " + tag); };
  const promise = Promise.resolve(holder);
  holder.then = undefined;
  return promise;
}

async function returned(tag) {
  const holder = { then: undefined, v: tag };
  holder.then = function (resolve) { resolve("returned " + tag); };
  queueMicrotask(() => { holder.then = undefined; });
  return holder;
}

async function main() {
  console.log(await numberOrThenable(true), await numberOrThenable(false));
  console.log(await awaited());
  install();
  console.log(await awaited());
  for await (const step of steps) console.log(step);
  for (let i = 0; i < 3; i++) {
    console.log("overwritten", await overwritten(i));
    console.log("stored late", typeof await storedLate(i));
    console.log("inherited", await inherited(i));
    console.log("escaped first", await escapedFirst(i), kept.then);
    console.log("returned", await returned(i));
  }
  console.log(await Promise.all([overwritten(7), { then(resolve) { resolve("in all"); } }, 3]));
}
main();
