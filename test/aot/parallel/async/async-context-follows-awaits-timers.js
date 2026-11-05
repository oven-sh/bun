// What AsyncLocalStorage.getStore() answers behind every kind of wait, in functions that run side by side under different stores, under none, and under a store entered half way.
const { AsyncLocalStorage, AsyncResource } = require("node:async_hooks");
const first = new AsyncLocalStorage();
const second = new AsyncLocalStorage();
const lines = [];
const seen = where => lines.push(where + " " + String(first.getStore()) + " " + String(second.getStore()));

const later = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = () => new Promise(resolve => process.nextTick(resolve));
const immediate = () => new Promise(resolve => setImmediate(resolve));
const micro = () => new Promise(resolve => queueMicrotask(resolve));
const thenable = value => ({ then(resolve) { seen("then of a thenable " + value); resolve(value); } });

async function finishesAtOnce(value) {
  return value;
}
async function suspendsOnce(value) {
  await null;
  return value;
}
async function suspendsTwice(name, value) {
  await null;
  seen(name + " inside, after one");
  await undefined;
  seen(name + " inside, after two");
  return value;
}
async function throwsLater(name) {
  await null;
  throw new Error(name);
}
async function* counts(name) {
  seen(name + " generator starts");
  yield 1;
  await null;
  seen(name + " generator goes on");
  yield 2;
}

async function everyWait(name) {
  seen(name + " start");
  await 1;
  seen(name + " number");
  await finishesAtOnce(1);
  seen(name + " call that finishes at once");
  await suspendsOnce(1);
  seen(name + " call that suspends");
  await suspendsTwice(name, 1);
  seen(name + " call that suspends twice");
  await Promise.resolve(1);
  seen(name + " settled promise");
  await micro();
  seen(name + " microtask");
  await tick();
  seen(name + " tick");
  await later(1);
  seen(name + " timer");
  await immediate();
  seen(name + " immediate");
  await thenable(name);
  seen(name + " thenable");
  await Promise.all([suspendsOnce(1), later(1), 2, finishesAtOnce(3)]);
  seen(name + " all");
  await Promise.race([later(1), later(2)]);
  seen(name + " race");
  try {
    await throwsLater(name);
  } catch {
    seen(name + " caught");
  }
  for await (const count of counts(name)) seen(name + " step " + count);
  await suspendsOnce(1).then(() => seen(name + " then"));
  seen(name + " after then");
  await suspendsOnce(1).finally(() => seen(name + " finally"));
  seen(name + " end");
}

// The promise is made under one store, awaited under a second and resolved under a third.
async function awaitsWhatOthersResolve() {
  let resolve;
  const promise = first.run("maker", () => new Promise(r => (resolve = r)));
  const waiting = first.run("waiter", async () => {
    await promise;
    seen("resolved by another");
    await suspendsOnce(1);
    seen("resolved by another, one wait on");
  });
  first.run("resolver", () => resolve(1));
  await waiting;
  seen("behind the waiter");
}

// A store that is entered half way holds for the rest of the function and for what it starts, and ends with the job for everybody else.
async function entersHalfWay() {
  await null;
  seen("before enterWith");
  first.enterWith("entered");
  seen("after enterWith");
  await suspendsOnce(1);
  seen("after enterWith, one wait on");
  const inner = suspendsTwice("started after enterWith", 1);
  first.enterWith("entered again");
  await inner;
  seen("after the second enterWith");
}
async function runsBesideIt() {
  for (let i = 0; i < 6; i++) {
    await null;
    seen("beside " + i);
  }
}

async function leavesAndBinds() {
  await first.run("outer", async () => {
    await null;
    first.exit(() => seen("exit"));
    await first.exit(async () => {
      await null;
      seen("exit, one wait on");
    });
    seen("behind exit");
    const bound = AsyncLocalStorage.bind(() => seen("bound"));
    const snapshot = AsyncLocalStorage.snapshot();
    const resource = new AsyncResource("test");
    await second.run("other", async () => {
      await first.run("inner", async () => {
        await null;
        bound();
        snapshot(() => seen("snapshot"));
        resource.runInAsyncScope(() => seen("resource"));
        seen("behind the three");
      });
      seen("behind inner");
    });
    seen("behind other");
  });
  seen("behind outer");
}

async function main() {
  seen("nothing entered yet");
  await everyWait("none");
  const before = lines.length;
  await Promise.all([
    first.run("a", () => everyWait("a")),
    everyWait("beside"),
    first.run("b", () => second.run("c", () => everyWait("bc"))),
    second.run("d", () => everyWait("d")),
  ]);
  // Whether the timer of one comes due in front of the immediate of another is the clock's to say, so the lines of the four are printed function by function.
  const sideBySide = lines.splice(before);
  for (const name of ["a", "beside", "bc", "d"]) lines.push(...sideBySide.filter(line => line.startsWith(name + " ") || line.startsWith("then of a thenable " + name + " ")));
  seen("behind all four");
  await awaitsWhatOthersResolve();
  await Promise.all([entersHalfWay(), runsBesideIt()]);
  seen("behind enterWith");
  await leavesAndBinds();
  first.disable();
  await first.run("again", () => suspendsTwice("after disable", 1));
  seen("end");
}
main().then(() => console.log(lines.join("\n")));
