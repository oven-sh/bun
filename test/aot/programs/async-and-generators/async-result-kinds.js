// What an async function hands to the code that awaits it, by kind of result: a number, nothing, an object literal, a class instance, a promise, a thenable, an instance of a class that gets `then` later. Each is returned before any await and after one, and the call is awaited directly and through a variable. Jobs queued with queueMicrotask count how long each takes.
// CALLS+ number ReturnAsyncResult
// CALLS+ awaitedDirectly AwaitBySavingFrame\.ResultOfCallWithoutPromise
// CALLS+ awaitedThroughVariable AwaitBySavingFrame\.Value
// CALLS- awaitedThroughVariable AwaitBySavingFrame\.ResultOfCallWithoutPromise
const log = [];
let section = "";
const when = late => (late ? "after an await" : "before any await");

function show(value) {
  if (value === null || typeof value !== "object") return String(value);
  return value.constructor.name + JSON.stringify(value);
}

function startTicks() {
  let count = 0;
  let stopped = false;
  const tick = () => {
    if (stopped || count === 40) return;
    count++;
    queueMicrotask(tick);
  };
  queueMicrotask(tick);
  return () => {
    stopped = true;
    return count;
  };
}

function note(kind, value, stop) {
  log.push(section + ", " + kind + ": " + show(value) + " after " + stop() + " ticks");
}

const label = (kind, promise) => (promise instanceof Promise ? kind : kind + " (not a promise)");

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class Late {
  constructor(tag) {
    this.tag = tag;
  }
}
class Child extends Late {}
class Deferred {
  constructor(value) {
    this.value = value;
  }
  then(resolve) {
    log.push("  then of Deferred runs");
    resolve("deferred " + this.value);
  }
}

async function number(late) {
  if (late) await null;
  return 7;
}
async function nothing(late) {
  if (late) await null;
}
async function literal(late) {
  if (late) await null;
  return { a: 1, b: "two" };
}
async function instance(late) {
  if (late) await null;
  return new Point(3, 4);
}
async function settledPromise(late) {
  if (late) await null;
  return Promise.resolve("settled");
}
async function pendingPromise(late) {
  if (late) await null;
  return new Promise(resolve => queueMicrotask(() => resolve("pending")));
}
async function rejectedPromise(late) {
  if (late) await null;
  return Promise.reject("failed");
}
async function thenable(late) {
  if (late) await null;
  return {
    then(resolve) {
      log.push("  then of the literal runs");
      resolve("from then");
    },
  };
}
async function thenableInstance(late) {
  if (late) await null;
  return new Deferred(5);
}
async function lateInstance(late) {
  if (late) await null;
  return new Late("late");
}
async function childInstance(late) {
  if (late) await null;
  return new Child("child");
}

async function awaitedDirectly(late) {
  section = "direct, " + when(late);
  let stop = startTicks();
  note("number", await number(late), stop);
  stop = startTicks();
  note("nothing", await nothing(late), stop);
  stop = startTicks();
  note("literal", await literal(late), stop);
  stop = startTicks();
  note("instance", await instance(late), stop);
  stop = startTicks();
  note("settled promise", await settledPromise(late), stop);
  stop = startTicks();
  note("pending promise", await pendingPromise(late), stop);
  stop = startTicks();
  try {
    await rejectedPromise(late);
  } catch (reason) {
    note("rejected promise", reason, stop);
  }
  stop = startTicks();
  note("thenable", await thenable(late), stop);
  stop = startTicks();
  note("thenable instance", await thenableInstance(late), stop);
  stop = startTicks();
  note("late instance", await lateInstance(late), stop);
  stop = startTicks();
  note("child instance", await childInstance(late), stop);
}

async function awaitedThroughVariable(late) {
  section = "variable, " + when(late);
  let stop = startTicks();
  let promise = number(late);
  note(label("number", promise), await promise, stop);
  stop = startTicks();
  promise = nothing(late);
  note(label("nothing", promise), await promise, stop);
  stop = startTicks();
  promise = literal(late);
  note(label("literal", promise), await promise, stop);
  stop = startTicks();
  promise = instance(late);
  note(label("instance", promise), await promise, stop);
  stop = startTicks();
  promise = settledPromise(late);
  note(label("settled promise", promise), await promise, stop);
  stop = startTicks();
  promise = pendingPromise(late);
  note(label("pending promise", promise), await promise, stop);
  stop = startTicks();
  promise = rejectedPromise(late);
  try {
    await promise;
  } catch (reason) {
    note(label("rejected promise", promise), reason, stop);
  }
  stop = startTicks();
  promise = thenable(late);
  note(label("thenable", promise), await promise, stop);
  stop = startTicks();
  promise = thenableInstance(late);
  note(label("thenable instance", promise), await promise, stop);
  stop = startTicks();
  promise = lateInstance(late);
  note(label("late instance", promise), await promise, stop);
  stop = startTicks();
  promise = childInstance(late);
  note(label("child instance", promise), await promise, stop);
}

async function settledTogether(late) {
  const order = [];
  const ticks = new Promise(resolve => {
    let count = 0;
    const tick = () => {
      order.push("tick " + ++count);
      if (count < 8) queueMicrotask(tick);
      else resolve();
    };
    queueMicrotask(tick);
  });
  await Promise.all([
    (async () => order.push("number " + show(await number(late))))(),
    (async () => order.push("literal " + show(await literal(late))))(),
    (async () => order.push("instance " + show(await instance(late))))(),
    (async () => order.push("settled promise " + show(await settledPromise(late))))(),
    (async () => order.push("pending promise " + show(await pendingPromise(late))))(),
    (async () => order.push("thenable " + show(await thenable(late))))(),
    (async () => order.push("late instance " + show(await lateInstance(late))))(),
    ticks,
  ]);
  log.push("together, " + when(late) + ": " + order.join(" | "));
}

async function everyKind(title) {
  log.push("== " + title);
  for (const late of [false, true]) {
    await awaitedDirectly(late);
    await awaitedThroughVariable(late);
    await settledTogether(late);
  }
}

class Warm {
  constructor(n) {
    this.n = n;
  }
}
async function warmEarly(n) {
  return new Warm(n);
}
async function warmLate(n) {
  await null;
  return new Warm(n);
}

async function prototypeGetsThenAfterManyCalls() {
  log.push("== a prototype gets then after 1,000 calls");
  let total = 0;
  for (let i = 0; i < 1000; i++) {
    total += (await warmEarly(i)).n;
    total += (await warmLate(i)).n;
    const promise = warmEarly(i);
    total += (await promise).n;
  }
  log.push("instances: " + total);
  let calls = 0;
  Warm.prototype.then = function (resolve) {
    calls++;
    resolve(-this.n);
  };
  const unwrapped = [];
  for (let i = 1; i <= 3; i++) {
    unwrapped.push(await warmEarly(i), await warmLate(i));
    const promise = warmLate(i);
    unwrapped.push(await promise);
  }
  log.push("unwrapped: " + unwrapped.join() + " by " + calls + " calls of then");
  section = "then on the prototype";
  let stop = startTicks();
  note("before any await", await warmEarly(4), stop);
  stop = startTicks();
  note("after an await", await warmLate(4), stop);
  delete Warm.prototype.then;
  section = "then deleted from the prototype";
  stop = startTicks();
  note("before any await", await warmEarly(5), stop);
  stop = startTicks();
  note("after an await", await warmLate(5), stop);
  log.push("calls of then: " + calls);
}

function ownThen(resolve) {
  resolve("own then of " + this.constructor.name);
}
async function instanceWithThen(late, then) {
  const point = new Point(1, 2);
  if (late) await null;
  point.then = then;
  return point;
}
async function literalWithThen(late, then) {
  const object = { a: 1, b: "two" };
  if (late) await null;
  object.then = then;
  return object;
}
async function instanceAfterThenDeleted(late) {
  const point = new Point(5, 6);
  point.then = resolve => resolve("never seen");
  if (late) await null;
  delete point.then;
  return point;
}

async function thenAddedAfterCreation(late) {
  section = "own then, " + when(late);
  let stop = startTicks();
  note("instance", await instanceWithThen(late, ownThen), stop);
  stop = startTicks();
  note("literal", await literalWithThen(late, ownThen), stop);
  stop = startTicks();
  note("instance, then is 5", await instanceWithThen(late, 5), stop);
  stop = startTicks();
  note("literal, then is null", await literalWithThen(late, null), stop);
  stop = startTicks();
  note("instance, then deleted", await instanceAfterThenDeleted(late), stop);
  stop = startTicks();
  let promise = instanceWithThen(late, ownThen);
  note(label("instance in a variable", promise), await promise, stop);
  stop = startTicks();
  promise = literalWithThen(late, ownThen);
  note(label("literal in a variable", promise), await promise, stop);
  stop = startTicks();
  note("another instance", await instance(late), stop);
  stop = startTicks();
  note("another literal", await literal(late), stop);
}

let reads = 0;
async function counted(late, then) {
  if (late) await null;
  return Object.defineProperty({ kind: "counted" }, "then", {
    configurable: true,
    get() {
      reads++;
      return then;
    },
  });
}

async function accessorCountsReads(late) {
  section = "accessor then, " + when(late);
  reads = 0;
  let stop = startTicks();
  note("answers undefined", await counted(late, undefined), stop);
  log.push(section + ": " + reads + " reads");
  stop = startTicks();
  note("answers a function", await counted(late, resolve => resolve("from the accessor")), stop);
  log.push(section + ": " + reads + " reads");
  stop = startTicks();
  const promise = counted(late, undefined);
  note(label("in a variable", promise), await promise, stop);
  log.push(section + ": " + reads + " reads");
  const object = await promise;
  log.push(section + ": " + reads + " reads");
  stop = startTicks();
  note("awaited itself", await object, stop);
  log.push(section + ": " + reads + " reads");
}

async function main() {
  await everyKind("as declared");
  await prototypeGetsThenAfterManyCalls();
  log.push("== then is added to an object after its creation");
  for (const late of [false, true]) await thenAddedAfterCreation(late);
  log.push("== an own accessor then counts its reads");
  for (const late of [false, true]) await accessorCountsReads(late);
  let calls = 0;
  Late.prototype.then = function (resolve) {
    calls++;
    resolve("unwrapped " + this.tag);
  };
  await everyKind("Late.prototype has then");
  log.push("calls of then: " + calls);
  delete Late.prototype.then;
  await everyKind("Late.prototype has no then again");
  log.push("calls of then: " + calls);
  console.log(log.join("\n"));
}
main();
