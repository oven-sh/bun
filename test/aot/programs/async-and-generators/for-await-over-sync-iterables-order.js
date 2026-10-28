// `for await` over an array, a Set, a Map, a typed array and a generator, each in a loop of its own, so that the build knows the class of what it walks. The language wraps the sync iterator:
// a step takes one turn of the job queue more than an await of the value, what a step throws arrives one turn later, and leaving the loop takes a turn. The log shows the order of the loop bodies
// among reactions that were registered before the loop, jobs that the body queues and reactions on the elements: for elements that are promises in every state, thenables, objects with a `then`
// getter and everything else; when the loop runs to its end, breaks, returns or throws; with an empty job queue and beside other jobs; in a function that a job entered and in one that has never
// been suspended. A generator is closed before the loop hears of a rejected value. An object with a Symbol.asyncIterator or a Symbol.iterator of its own is asked for it.
// Arrays, Sets, Maps and typed arrays are walked without the wrapper. A generator keeps it, and so does whatever an async generator walks.
// IR+ \[takesExtraTurn\]
// IR= 0 overGenerator takesExtraTurn
// IR= 0 relay takesExtraTurn
const settled = Promise.resolve();
const lines = [];
let log = [];

function note(text) {
  log.push(text);
}
function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join(", ") + "]";
  return Object.hasOwn(value, "label") ? "<" + value.label + ">" : "an object";
}
function messageOf(error) {
  if (error instanceof TypeError) return "a TypeError";
  return error instanceof Error ? error.message : show(error);
}
function fails(message) {
  throw new RangeError(message);
}
function timer(value) {
  return new Promise(resolve => {
    setTimeout(() => resolve(value), 0);
  });
}

// A chain of reactions: one runs in each turn of the job queue.
function ticks(count) {
  let last = settled;
  for (let i = 1; i <= count; i++) last = last.then(() => note("t" + i));
  return last;
}
// A chain of jobs: each queues the next.
function jobs(label, count) {
  let done = 0;
  const run = () => {
    note(label + "abcdef"[done++]);
    if (done < count) queueMicrotask(run);
  };
  queueMicrotask(run);
}
function afterJobs(count, settle) {
  let left = count;
  const step = () => {
    if (--left > 0) queueMicrotask(step);
    else settle();
  };
  queueMicrotask(step);
}
function fulfilledAfterJobs(count, value) {
  return new Promise(resolve => afterJobs(count, () => resolve(value)));
}
function rejected(message) {
  const promise = Promise.reject(new RangeError(message));
  promise.catch(() => {});
  return promise;
}
function rejectedAfterJobs(count, message) {
  const promise = new Promise((resolve, reject) => afterJobs(count, () => reject(new RangeError(message))));
  promise.catch(() => {});
  return promise;
}
function thenable(label, settle) {
  return {
    label,
    then(resolve, reject) {
      note("then of " + label);
      settle(resolve, reject);
    },
  };
}
class Deferred {
  constructor(label, value) {
    this.label = label;
    this.value = value;
  }
  then(resolve) {
    note("then of " + this.label);
    resolve(this.value);
  }
}
class OwnPromise extends Promise {}

// What the loops below walk, as a list. No list has a hole: each becomes a Set and a generator as well, the first six also a Map.
const elements = [
  ["numbers", () => [1, 2, 3]],
  ["nothing", () => []],
  ["one value", () => ["only"]],
  ["values of every kind", () => ["text", null, undefined, 1.5, true, 10n, Symbol.for("shared"), { label: "object" }, [1, [2]]]],
  ["fulfilled promises", () => [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]],
  ["a promise between values", () => [1, Promise.resolve(2), 3]],
  ["promises fulfilled after jobs", () => [fulfilledAfterJobs(3, "after three"), 2, fulfilledAfterJobs(1, "after one")]],
  ["a promise fulfilled by a timer", () => [1, timer("by a timer"), 3]],
  ["a promise resolved with a promise", () => [new Promise(resolve => resolve(Promise.resolve(1))), 2]],
  ["a rejected promise", () => [1, rejected("rejected"), 3]],
  ["a rejected promise first", () => [rejected("rejected first"), 2]],
  ["a rejected promise last", () => [1, rejected("rejected last")]],
  ["a promise rejected after jobs", () => [1, rejectedAfterJobs(3, "rejected late"), 3]],
  [
    "an element with other reactions",
    () => {
      const element = fulfilledAfterJobs(4, "late");
      element.then(() => note("a reaction from before the loop"));
      afterJobs(2, () => void element.then(() => note("a reaction from after the step")));
      return [element, 2];
    },
  ],
  [
    "a rejected element with other reactions",
    () => {
      const element = rejectedAfterJobs(4, "rejected late");
      element.catch(() => note("a reaction from before the loop"));
      afterJobs(2, () => void element.catch(() => note("a reaction from after the step")));
      return [element, 2];
    },
  ],
  ["thenables", () => [thenable("a", resolve => resolve(1)), thenable("b", resolve => queueMicrotask(() => resolve(2))), 3]],
  ["a thenable that gives a thenable", () => [thenable("outer", resolve => resolve(thenable("inner", resolveInner => resolveInner(1)))), 2]],
  ["a thenable that gives a promise", () => [thenable("c", resolve => resolve(fulfilledAfterJobs(2, "from a promise"))), 2]],
  ["a thenable that rejects", () => [1, thenable("d", (resolve, reject) => reject(new RangeError("rejected by then"))), 3]],
  ["a thenable that throws", () => [1, thenable("e", () => fails("then throws")), 3]],
  ["a thenable that settles twice", () => [thenable("f", (resolve, reject) => (resolve(1), reject(new RangeError("too late")), resolve(2))), 3]],
  ["instances of a class with then", () => [new Deferred("g", 1), 2, new Deferred("h", 3)]],
  [
    "a then getter that gives nothing",
    () => [
      {
        label: "i",
        get then() {
          note("then of i is read");
          return undefined;
        },
      },
      2,
    ],
  ],
  [
    "a then getter that gives a function",
    () => [
      {
        label: "j",
        get then() {
          note("then of j is read");
          return resolve => {
            note("then of j is called");
            resolve(1);
          };
        },
      },
      2,
    ],
  ],
  [
    "a then getter that throws",
    () => [
      1,
      {
        label: "k",
        get then() {
          note("then of k is read");
          return fails("then cannot be read");
        },
      },
      3,
    ],
  ],
  ["a then that is no function", () => [{ label: "l", then: 1 }, { label: "m", then: null }, 3]],
  [
    "a promise with its own then",
    () => {
      const promise = Promise.resolve(1);
      promise.then = function (onFulfilled, onRejected) {
        note("its own then");
        return Promise.prototype.then.call(this, onFulfilled, onRejected);
      };
      return [promise, 2];
    },
  ],
  [
    "a promise whose constructor is read",
    () => {
      const promise = Promise.resolve(1);
      Object.defineProperty(promise, "constructor", {
        get() {
          note("constructor is read");
          return Promise;
        },
      });
      return [promise, 2];
    },
  ],
  [
    "a promise whose constructor cannot be read",
    () => {
      const promise = Promise.resolve(1);
      Object.defineProperty(promise, "constructor", {
        get() {
          note("constructor is read");
          return fails("constructor cannot be read");
        },
      });
      return [0, promise, 2];
    },
  ],
  [
    "a promise with another constructor",
    () => {
      const promise = Promise.resolve(1);
      Object.defineProperty(promise, "constructor", { value: OwnPromise });
      return [promise, 2];
    },
  ],
  ["promises of a subclass", () => [OwnPromise.resolve(1), 2, OwnPromise.resolve(3)]],
];

function walkOf(name, options) {
  return { name, seen: 0, startsInAJob: false, awaits: false, jobs: 0, actsAt: 0, act: undefined, leavesAt: 0, leaves: "", ...options };
}
// What the body of every loop below does with a value. Answers how the loop is left, if it is.
function visit(walk, value) {
  note(walk.name + "sees " + show(value));
  walk.seen++;
  if (walk.jobs) jobs(walk.name + walk.seen, walk.jobs);
  if (walk.seen === walk.actsAt) walk.act();
  return walk.seen === walk.leavesAt ? walk.leaves : "";
}

// The same function once for each class.
async function overArray(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}
async function overSet(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}
async function overMap(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}
async function overView(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}
async function overGenerator(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}
async function overIterable(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of items) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "return") return "from the loop";
      if (leaves === "throw") fails("thrown in the loop");
      if (walk.awaits) {
        await settled;
        note(walk.name + "goes on");
      }
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  } finally {
    note(walk.name + "is done");
  }
  return "from behind the loop";
}

function* generate(items) {
  try {
    for (const item of items) {
      note("yields");
      yield item;
    }
    note("the generator ends");
    return "the result";
  } finally {
    note("the generator is closed");
  }
}
// What `close` answers becomes the result of return(), unless it answers undefined.
function* closes(items, close) {
  try {
    for (const item of items) yield item;
  } finally {
    note("the generator is being closed");
    const result = close();
    if (result !== undefined) return result;
  }
}
function* yieldsWhileClosed(items) {
  try {
    for (const item of items) yield item;
  } finally {
    note("the generator yields while it is closed");
    yield "not closed";
  }
}
function* endsWith(items, end) {
  for (const item of items) yield item;
  return end();
}
function counter(items, close) {
  return {
    [Symbol.iterator]() {
      note("iterator");
      let i = 0;
      return {
        next() {
          note("next/" + arguments.length);
          return i < items.length ? { done: false, value: items[i++] } : { done: true, value: undefined };
        },
        return() {
          note("return/" + arguments.length);
          return close();
        },
      };
    },
  };
}
function asyncIteratorOf(label, values) {
  return function () {
    note(label + " is asked for an async iterator");
    let i = 0;
    return {
      next() {
        note(label + " next");
        return Promise.resolve(i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined });
      },
      return() {
        note(label + " return");
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  };
}

// The job queue is empty when `run` is called, but for the reactions of `ticks`. Whatever is still queued when the loop has ended is logged as well.
async function scenario(title, numberOfTicks, run) {
  log = [];
  const chain = ticks(numberOfTicks);
  const result = await run();
  note("returns " + show(result));
  await chain;
  await timer();
  lines.push(title + ": " + log.join(" | "));
}

const walks = [
  ["to the end", {}],
  ["to the end, entered by a job", { startsInAJob: true }],
  ["breaks at the second value", { leaves: "break", leavesAt: 2, startsInAJob: true }],
  ["breaks at the first value", { leaves: "break", leavesAt: 1 }],
  ["returns at the second value", { leaves: "return", leavesAt: 2 }],
  ["throws at the second value", { leaves: "throw", leavesAt: 2, startsInAJob: true }],
  ["awaits in the body", { awaits: true }],
  ["queues jobs in the body", { jobs: 3, startsInAJob: true }],
];
for (const [walkLabel, options] of walks) {
  for (const numberOfTicks of [0, 9]) {
    lines.push("== " + walkLabel + (numberOfTicks ? ", beside other jobs" : ", alone"));
    for (const [label, make] of elements) {
      await scenario("an array: " + label, numberOfTicks, () => overArray(make(), walkOf("", options)));
      await scenario("a Set: " + label, numberOfTicks, () => overSet(new Set(make()), walkOf("", options)));
      await scenario("a generator: " + label, numberOfTicks, () => overGenerator(generate(make()), walkOf("", options)));
    }
    // A Map gives pairs, and a pair is no promise whatever it holds.
    for (const [label, make] of elements.slice(0, 6))
      await scenario("a Map: " + label, numberOfTicks, () => overMap(new Map(make().map((item, index) => [index, item])), walkOf("", options)));
    await scenario("bytes", numberOfTicks, () => overView(new Uint8Array([7, 8, 9]), walkOf("", options)));
    await scenario("no bytes", numberOfTicks, () => overView(new Uint8Array(0), walkOf("", options)));
    await scenario("doubles", numberOfTicks, () => overView(new Float64Array([0.5, NaN, -1]), walkOf("", options)));
  }
}

for (const numberOfTicks of [0, 9]) {
  lines.push("== what a step throws" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  await scenario("an element that cannot be read", numberOfTicks, () => {
    const items = [1, 2, 3];
    Object.defineProperty(items, 1, { get: () => fails("an element cannot be read") });
    return overArray(items, walkOf("", { startsInAJob: true }));
  });
  await scenario("a hole", numberOfTicks, () => overArray([1, , 3], walkOf("", {})));
  await scenario("a typed array that the body detaches", numberOfTicks, () => {
    const bytes = new Uint8Array([7, 8, 9]);
    return overView(bytes, walkOf("", { actsAt: 2, act: () => void bytes.buffer.transfer(), startsInAJob: true }));
  });
  await scenario("a typed array that a job detaches while the loop waits", numberOfTicks, () => {
    const bytes = new Uint8Array([7, 8, 9]);
    return overView(bytes, walkOf("", { actsAt: 1, act: () => queueMicrotask(() => void bytes.buffer.transfer()) }));
  });
  await scenario("a typed array that was detached before the loop", numberOfTicks, () => {
    const bytes = new Uint8Array([7, 8, 9]);
    bytes.buffer.transfer();
    return overView(bytes, walkOf("", { startsInAJob: true }));
  });
  await scenario("a generator that throws", numberOfTicks, () => overGenerator(endsWith([1, 2], () => fails("thrown by the generator")), walkOf("", {})));
  await scenario("a generator that returns a rejected promise", numberOfTicks, () => overGenerator(endsWith([1], () => rejected("rejected at the end")), walkOf("", {})));
  await scenario("a generator that returns a thenable", numberOfTicks, () => overGenerator(endsWith([1], () => thenable("n", resolve => resolve("never seen"))), walkOf("", {})));

  lines.push("== what closing does" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  for (const leaves of ["break", "return", "throw"]) {
    const options = { leaves, leavesAt: 2, startsInAJob: true };
    await scenario(leaves + ", and closing throws", numberOfTicks, () => overGenerator(closes([1, 2, 3], () => fails("thrown while closing")), walkOf("", options)));
    await scenario(leaves + ", and closing returns a value", numberOfTicks, () => overGenerator(closes([1, 2, 3], () => "closed"), walkOf("", options)));
    await scenario(leaves + ", and closing returns a promise", numberOfTicks, () => overGenerator(closes([1, 2, 3], () => fulfilledAfterJobs(2, "closed late")), walkOf("", options)));
    await scenario(leaves + ", and closing returns a rejected promise", numberOfTicks, () => overGenerator(closes([1, 2, 3], () => rejected("rejected while closing")), walkOf("", options)));
    await scenario(leaves + ", and closing returns a thenable", numberOfTicks, () => overGenerator(closes([1, 2, 3], () => thenable("o", resolve => resolve("closed"))), walkOf("", options)));
    await scenario(leaves + ", and the generator yields", numberOfTicks, () => overGenerator(yieldsWhileClosed([1, 2, 3]), walkOf("", options)));
    await scenario(leaves + ", and return() of an iterator throws", numberOfTicks, () => overIterable(counter([1, 2, 3], () => fails("return throws")), walkOf("", options)));
    await scenario(leaves + ", and return() of an iterator answers with a number", numberOfTicks, () => overIterable(counter([1, 2, 3], () => 5), walkOf("", options)));
    await scenario(leaves + ", and return() of an iterator answers with an object", numberOfTicks, () => overIterable(counter([1, 2, 3], () => ({})), walkOf("", options)));
  }
  await scenario("a rejected value, and closing throws", numberOfTicks, () => overGenerator(closes([1, rejected("rejected"), 3], () => fails("thrown while closing")), walkOf("", {})));
  await scenario("a rejected value, and closing returns a promise", numberOfTicks, () => overGenerator(closes([1, rejected("rejected"), 3], () => fulfilledAfterJobs(2, "closed late")), walkOf("", {})));
  await scenario("a rejected value, and the generator yields", numberOfTicks, () => overGenerator(yieldsWhileClosed([1, rejected("rejected"), 3]), walkOf("", {})));
  await scenario("a value rejected late, and closing throws", numberOfTicks, () => overGenerator(closes([1, rejectedAfterJobs(3, "rejected late"), 3], () => fails("thrown while closing")), walkOf("", {})));
  await scenario("a rejected value, and return() of an iterator throws", numberOfTicks, () => overIterable(counter([1, rejected("rejected"), 3], () => fails("return throws")), walkOf("", {})));

  lines.push("== what changes while the loop waits" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  await scenario("an array grows in the body", numberOfTicks, () => {
    const items = [1, 2];
    return overArray(items, walkOf("", { actsAt: 2, act: () => void items.push("pushed", Promise.resolve("pushed as a promise")) }));
  });
  await scenario("an array grows in a job", numberOfTicks, () => {
    const items = [1, 2];
    return overArray(items, walkOf("", { actsAt: 1, act: () => queueMicrotask(() => void items.push("pushed")), startsInAJob: true }));
  });
  await scenario("an array grows in a job behind the last step", numberOfTicks, () => {
    const items = [1, 2];
    return overArray(items, walkOf("", { actsAt: 2, act: () => queueMicrotask(() => void items.push("pushed too late")), startsInAJob: true }));
  });
  await scenario("an array shrinks in a job", numberOfTicks, () => {
    const items = [1, 2, 3, 4];
    return overArray(items, walkOf("", { actsAt: 1, act: () => queueMicrotask(() => void (items.length = 2)) }));
  });
  await scenario("a Set is filled, emptied and collected in a job", numberOfTicks, () => {
    const items = new Set(["a", "b"]);
    const change = () => {
      for (let i = 0; i < 40; i++) items.add(i);
      for (let i = 0; i < 38; i++) items.delete(i);
      items.delete("b");
      Bun.gc(true);
    };
    return overSet(items, walkOf("", { actsAt: 1, act: () => queueMicrotask(change), startsInAJob: true }));
  });
  await scenario("a Set is cleared and filled again in a job", numberOfTicks, () => {
    const items = new Set(["a", "b", "c"]);
    const change = () => {
      items.clear();
      items.add("d").add("a");
    };
    return overSet(items, walkOf("", { actsAt: 2, act: () => queueMicrotask(change) }));
  });
  await scenario("a Map is filled, emptied and collected in a job", numberOfTicks, () => {
    const items = new Map([["a", 1], ["b", 2]]);
    const change = () => {
      for (let i = 0; i < 40; i++) items.set(i, i);
      for (let i = 0; i < 38; i++) items.delete(i);
      items.set("b", "changed");
      Bun.gc(true);
    };
    return overMap(items, walkOf("", { actsAt: 1, act: () => queueMicrotask(change), startsInAJob: true }));
  });
  await scenario("a view of a buffer that grows in a job", numberOfTicks, () => {
    const buffer = new ArrayBuffer(2, { maxByteLength: 4 });
    const bytes = new Uint8Array(buffer);
    bytes.set([7, 8]);
    return overView(bytes, walkOf("", { actsAt: 1, act: () => queueMicrotask(() => void buffer.resize(3)) }));
  });

  lines.push("== objects that say themselves how they are walked" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  for (const leaves of ["", "break"]) {
    const options = { leaves, leavesAt: 1, startsInAJob: true };
    const suffix = leaves ? ", left early" : "";
    await scenario("an array with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items[Symbol.asyncIterator] = asyncIteratorOf("the array", ["own", "async"]);
      return overArray(items, walkOf("", options));
    });
    await scenario("a Set with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      const items = new Set([1, 2]);
      items[Symbol.asyncIterator] = asyncIteratorOf("the Set", ["own", "async"]);
      return overSet(items, walkOf("", options));
    });
    await scenario("a Map with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      const items = new Map([[1, 2]]);
      items[Symbol.asyncIterator] = asyncIteratorOf("the Map", ["own", "async"]);
      return overMap(items, walkOf("", options));
    });
    await scenario("a typed array with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      const items = new Uint8Array([1, 2]);
      items[Symbol.asyncIterator] = asyncIteratorOf("the typed array", ["own", "async"]);
      return overView(items, walkOf("", options));
    });
    await scenario("a generator with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      const items = generate([1, 2]);
      items[Symbol.asyncIterator] = asyncIteratorOf("the generator", ["own", "async"]);
      return overGenerator(items, walkOf("", options));
    });
    await scenario("an array with its own Symbol.iterator" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items[Symbol.iterator] = () => generate(["own", "sync"]);
      return overArray(items, walkOf("", options));
    });
    await scenario("a Set with its own Symbol.iterator" + suffix, numberOfTicks, () => {
      const items = new Set([1, 2]);
      items[Symbol.iterator] = () => generate(["own", "sync"]);
      return overSet(items, walkOf("", options));
    });
    await scenario("an array whose Symbol.asyncIterator is undefined" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items[Symbol.asyncIterator] = undefined;
      return overArray(items, walkOf("", options));
    });
    await scenario("an array whose Symbol.asyncIterator is null" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items[Symbol.asyncIterator] = null;
      return overArray(items, walkOf("", options));
    });
    await scenario("an array whose Symbol.asyncIterator is read" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      Object.defineProperty(items, Symbol.asyncIterator, {
        get() {
          note("Symbol.asyncIterator is read");
          return undefined;
        },
      });
      return overArray(items, walkOf("", options));
    });
    await scenario("an array whose Symbol.asyncIterator is no function" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items[Symbol.asyncIterator] = 5;
      return overArray(items, walkOf("", options));
    });
    await scenario("an array with another property" + suffix, numberOfTicks, () => {
      const items = [1, 2];
      items.name = "named";
      return overArray(items, walkOf("", options));
    });
    await scenario("a frozen array" + suffix, numberOfTicks, () => overArray(Object.freeze([1, 2]), walkOf("", options)));
    await scenario("an array under another prototype" + suffix, numberOfTicks, () => {
      const items = Object.setPrototypeOf([1, 2], { __proto__: Array.prototype, [Symbol.asyncIterator]: asyncIteratorOf("the prototype", ["inherited", "async"]) });
      return overArray(items, walkOf("", options));
    });
    await scenario("an instance of a subclass with its own Symbol.iterator" + suffix, numberOfTicks, () => {
      class Backwards extends Array {
        *[Symbol.iterator]() {
          note("the subclass is asked for an iterator");
          for (let i = this.length; i-- > 0; ) yield this[i];
        }
      }
      return overArray(Backwards.of(1, 2, 3), walkOf("", options));
    });
    await scenario("an instance of a subclass with its own Symbol.asyncIterator" + suffix, numberOfTicks, () => {
      class Streamed extends Array {
        async *[Symbol.asyncIterator]() {
          note("the subclass is asked for an async iterator");
          for (let i = 0; i < this.length; i++) yield "streamed " + this[i];
        }
      }
      return overArray(Streamed.of(1, 2, 3), walkOf("", options));
    });
    await scenario("an instance of a subclass that adds nothing" + suffix, numberOfTicks, () => {
      class Same extends Array {}
      return overArray(Same.of(1, 2, 3), walkOf("", options));
    });
  }
}

// Plain Bun takes a change to one of these prototypes. A compiled program refuses it with a TypeError, because it locks what the built-in iterations rely on
// (language/array-and-iterator-prototypes-keep-their-members, language/collection-prototypes-keep-their-members). Either way the loop has to do what the object says afterwards.
async function afterTryingToChange(title, object, key, mark, value, run) {
  const before = Object.getOwnPropertyDescriptor(object, key);
  try {
    Object.defineProperty(object, key, { value, writable: true, configurable: true });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  const after = Object.getOwnPropertyDescriptor(object, key);
  const isTaken = after !== undefined && after.value === value;
  log = [];
  await run();
  await timer();
  if (isTaken) {
    if (before) Object.defineProperty(object, key, before);
    else delete object[key];
  }
  lines.push(title + ": " + (log.includes(mark) === isTaken ? "the loop does what the object says" : "the loop does something else: " + log.join(" | ")));
}
const asked = "the prototype is asked for an async iterator";
const endsAtOnce = () => ({ done: true, value: undefined });
lines.push("== changes that a compiled program refuses");
await afterTryingToChange("Symbol.asyncIterator of Array.prototype", Array.prototype, Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overArray([1, 2], walkOf("", {})));
await afterTryingToChange("Symbol.asyncIterator of Set.prototype", Set.prototype, Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overSet(new Set([1, 2]), walkOf("", {})));
await afterTryingToChange("Symbol.asyncIterator of Map.prototype", Map.prototype, Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overMap(new Map([[1, 2]]), walkOf("", {})));
await afterTryingToChange("Symbol.asyncIterator of Uint8Array.prototype", Uint8Array.prototype, Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overView(new Uint8Array([1, 2]), walkOf("", {})));
await afterTryingToChange("Symbol.asyncIterator of the prototype of all typed arrays", Object.getPrototypeOf(Uint8Array.prototype), Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overView(new Uint8Array([1, 2]), walkOf("", {})));
await afterTryingToChange("Symbol.asyncIterator of Object.prototype", Object.prototype, Symbol.asyncIterator, asked, asyncIteratorOf("the prototype", ["inherited"]), () => overArray([1, 2], walkOf("", {})));
await afterTryingToChange(
  "Symbol.iterator of Array.prototype",
  Array.prototype,
  Symbol.iterator,
  "an iterator of the program",
  function () {
    note("an iterator of the program");
    return { next: endsAtOnce };
  },
  () => overArray([1, 2], walkOf("", {})),
);
await afterTryingToChange(
  "next of array iterators",
  Object.getPrototypeOf([].values()),
  "next",
  "a next of the program",
  function () {
    note("a next of the program");
    return endsAtOnce();
  },
  () => overArray([1, 2], walkOf("", {})),
);
await afterTryingToChange(
  "return of array iterators",
  Object.getPrototypeOf([].values()),
  "return",
  "a return of the program",
  function () {
    note("a return of the program");
    return {};
  },
  () => overArray([1, 2], walkOf("", { leaves: "break", leavesAt: 1 })),
);
await afterTryingToChange(
  "return of Set iterators",
  Object.getPrototypeOf(new Set().values()),
  "return",
  "a return of the program",
  function () {
    note("a return of the program");
    return {};
  },
  () => overSet(new Set([1, 2]), walkOf("", { leaves: "throw", leavesAt: 1 })),
);
await afterTryingToChange(
  "return of Map iterators",
  Object.getPrototypeOf(new Map().entries()),
  "return",
  "a return of the program",
  function () {
    note("a return of the program");
    return {};
  },
  () => overMap(new Map([[1, 2]]), walkOf("", { leaves: "return", leavesAt: 1 })),
);
await afterTryingToChange(
  "return of Iterator.prototype",
  Object.getPrototypeOf(Object.getPrototypeOf([].values())),
  "return",
  "a return of the program",
  function () {
    note("a return of the program");
    return {};
  },
  () => overArray([1, rejected("rejected"), 3], walkOf("", {})),
);
await afterTryingToChange(
  "then of Object.prototype",
  Object.prototype,
  "then",
  "a then of the program",
  function (resolve) {
    note("a then of the program");
    const result = Object.create(null);
    result.done = this.done;
    result.value = this.value;
    resolve(result);
  },
  () => overArray([1, 2], walkOf("", {})),
);

async function nested(rows, leaves, leavesAt) {
  try {
    outer: for await (const row of rows) {
      note("row " + show(row));
      for await (const cell of row) {
        note("cell " + show(cell));
        if (cell !== leavesAt) continue;
        if (leaves === "break") break;
        if (leaves === "break outer") break outer;
        if (leaves === "continue outer") continue outer;
        if (leaves === "return") return "from the inner loop";
        if (leaves === "throw") fails("thrown in the inner loop");
      }
      note("the row ends");
    }
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
  return "from behind the loops";
}
const summedByAnArrow = async items => {
  let sum = 0;
  for await (const item of items) {
    note("adds " + show(item));
    sum += item;
  }
  return sum;
};
class Reader {
  constructor(items) {
    this.items = items;
  }
  async read() {
    let text = "";
    for await (const [key, item] of this.items) {
      note("reads " + show(key));
      text += show(item);
    }
    return text;
  }
}
async function* relay(items) {
  try {
    for await (const item of items) {
      note("relays " + show(item));
      yield item;
    }
    note("the relay ends");
  } finally {
    note("the relay is closed");
  }
}
async function overRelay(items, walk) {
  if (walk.startsInAJob) await null;
  try {
    for await (const value of relay(items)) {
      const leaves = visit(walk, value);
      if (leaves === "break") break;
      if (leaves === "throw") fails("thrown in the loop");
    }
    note(walk.name + "ends");
  } catch (error) {
    note(walk.name + "caught " + messageOf(error));
  }
  return "from behind the loop";
}
async function madeAtTheLoop() {
  for await (const value of [1, Promise.resolve(2), thenable("p", resolve => resolve(3))]) note("the array gives " + show(value));
  for await (const value of new Set(["a", Promise.resolve("b")])) note("the Set gives " + show(value));
  for await (const [key, value] of new Map([["k", Promise.resolve("not awaited")]])) note("the Map gives " + show(key) + " and " + show(value));
  for await (const value of new Uint8Array([7, 8])) note("the typed array gives " + show(value));
  for await (const value of generate([Promise.resolve("g")])) note("the generator gives " + show(value));
  return "from behind the loops";
}

for (const numberOfTicks of [0, 9]) {
  lines.push("== several loops" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  await scenario("two arrays at once", numberOfTicks, async () => {
    const results = await Promise.all([overArray([1, 2, 3], walkOf("left ", {})), overArray(["x", Promise.resolve("y")], walkOf("right ", { startsInAJob: true }))]);
    return results.length;
  });
  await scenario("an array, a Set, a Map and a generator at once", numberOfTicks, async () => {
    const results = await Promise.all([
      overArray([1, 2], walkOf("array ", {})),
      overSet(new Set([1, 2]), walkOf("set ", {})),
      overMap(new Map([[1, 2]]), walkOf("map ", { leaves: "break", leavesAt: 1 })),
      overGenerator(generate([1, 2]), walkOf("generator ", {})),
    ]);
    return results.length;
  });
  await scenario("the same array twice", numberOfTicks, async () => {
    const items = [1, fulfilledAfterJobs(3, "late"), 3];
    const results = await Promise.all([overArray(items, walkOf("first ", {})), overArray(items, walkOf("second ", { awaits: true }))]);
    return results.length;
  });
  for (const leaves of ["", "break", "break outer", "continue outer", "return", "throw"])
    await scenario("rows and cells" + (leaves ? ", " + leaves : ""), numberOfTicks, () => nested([[1, 2], [3, Promise.resolve(4)], Promise.resolve([5])], leaves, 3));

  lines.push("== other kinds of functions" + (numberOfTicks ? ", beside other jobs" : ", alone"));
  await scenario("an arrow function", numberOfTicks, () => summedByAnArrow([1, Promise.resolve(2), 3]));
  await scenario("a method with a pattern", numberOfTicks, () => new Reader(new Map([["a", 1], ["b", Promise.resolve(2)]])).read());
  await scenario("an async generator", numberOfTicks, () => overRelay([1, Promise.resolve(2), 3], walkOf("", {})));
  await scenario("an async generator, left early", numberOfTicks, () => overRelay([1, 2, 3], walkOf("", { leaves: "break", leavesAt: 2, startsInAJob: true })));
  await scenario("an async generator, and the loop throws", numberOfTicks, () => overRelay([1, 2, 3], walkOf("", { leaves: "throw", leavesAt: 1 })));
  await scenario("an async generator over a rejected promise", numberOfTicks, () => overRelay([1, rejected("rejected"), 3], walkOf("", {})));
  await scenario("what is walked is made at the loop", numberOfTicks, madeAtTheLoop);
}

log = [];
const chainAtTopLevel = ticks(9);
for await (const value of [1, Promise.resolve(2), 3]) {
  note("the module sees " + show(value));
  if (value === 2) jobs("m", 3);
}
note("the module goes on");
await chainAtTopLevel;
lines.push("== at the top level of the module", log.join(" | "));

async function sumOfArray(items) {
  let sum = 0;
  for await (const item of items) sum += item;
  return sum;
}
async function sumOfSet(items) {
  let sum = 0;
  for await (const item of items) sum += item;
  return sum;
}
async function sumOfMap(items) {
  let sum = 0;
  for await (const [key, item] of items) sum += key + item;
  return sum;
}
async function sumOfView(items) {
  let sum = 0;
  for await (const item of items) sum += item;
  return sum;
}
const many = [];
for (let i = 0; i < 20000; i++) many.push(i);
lines.push("== long loops");
await timer();
lines.push("an array: " + (await sumOfArray(many)));
lines.push("a Set: " + (await sumOfSet(new Set(many))));
lines.push("a Map: " + (await sumOfMap(new Map(many.map(n => [n, 1])))));
lines.push("a typed array: " + (await sumOfView(Uint16Array.from(many))));
lines.push("fulfilled promises: " + (await sumOfArray(many.map(n => Promise.resolve(n)))));
lines.push("two arrays at once: " + (await Promise.all([sumOfArray(many), sumOfArray(many)])).join(" "));
lines.push("an array beside a chain of jobs: " + (await Promise.all([sumOfArray(many), ticks(100).then(() => "done")])).join(" "));
console.log(lines.join("\n"));
