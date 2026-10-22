// Steps of `for await` and `yield*` whose next method is one of the two built-in async ones: driven by an async function, an async generator and a module body, with an empty and a busy job queue.
// Also the cases that must stay ordinary calls: another next method, a receiver that is no generator, and next() written in the source, whose result objects the program keeps.
const lines = [];
const note = text => void lines.push(text);
const show = value => (value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value));

async function* count(label, limit) {
  try {
    for (let i = 0; i < limit; i++) yield label + i;
    return label + " result";
  } finally {
    note(label + " closed");
  }
}

async function* countAfterAwaits(label, limit) {
  for (let i = 0; i < limit; i++) {
    await null;
    yield await Promise.resolve(label + i);
  }
}

async function* echo(label) {
  let received = yield label + " started";
  while (received !== "stop") received = yield label + " got " + show(received);
  return label + " stopped";
}

async function* failsAt(label, limit) {
  for (let i = 0; i < limit; i++) yield label + i;
  throw new Error(label + " failed");
}

async function driveFromFunction(title, source, limit = Infinity) {
  const seen = [];
  try {
    for await (const value of source) {
      seen.push(value);
      if (seen.length >= limit) break;
    }
  } catch (error) {
    seen.push("caught " + show(error));
  }
  note(`${title}: ${seen.join(", ")}`);
}

async function* driveFromGenerator(source) {
  for await (const value of source) yield "relayed " + value;
}

async function* delegate(source) {
  const result = yield* source;
  yield "delegate result " + show(result);
}

function withBusyQueue(turns) {
  let turn = 0;
  const tick = () => {
    if (++turn <= turns) queueMicrotask(tick);
  };
  queueMicrotask(tick);
}

async function drivers() {
  await driveFromFunction("function", count("a", 3));
  await driveFromFunction("function, broken off", count("b", 3), 2);
  await driveFromFunction("function, awaits inside", countAfterAwaits("c", 3));
  await driveFromFunction("function, failure", failsAt("d", 2));
  await driveFromFunction("generator", driveFromGenerator(count("e", 3)));
  await driveFromFunction("generator, awaits inside", driveFromGenerator(countAfterAwaits("f", 3)));
  await driveFromFunction("generator, failure", driveFromGenerator(failsAt("g", 2)));
  await driveFromFunction("delegate", delegate(count("h", 2)));
  await driveFromFunction("delegate twice", delegate(delegate(count("i", 2))));
  await driveFromFunction("delegate, failure", delegate(failsAt("j", 1)));
  await driveFromFunction("empty", count("k", 0));
  withBusyQueue(40);
  await driveFromFunction("function, busy queue", count("l", 3));
  await driveFromFunction("generator, busy queue", driveFromGenerator(countAfterAwaits("m", 3)));
  await driveFromFunction("delegate, busy queue", delegate(count("n", 2)));
}

async function sentValues() {
  const outer = delegate(echo("echo"));
  for (const sent of [undefined, 1, { a: 1 }, undefined, "stop", "late"]) note("sent " + show(sent) + ": " + show(await outer.next(sent)));

  function argumentCounter() {
    let calls = 0;
    return {
      [Symbol.iterator]() {
        return this;
      },
      next(...sent) {
        return { done: ++calls > 3, value: `${sent.length} arguments ${show(sent)}` };
      },
    };
  }
  await driveFromFunction("sync next from for await", argumentCounter());
  const overSync = delegate(argumentCounter());
  for (const sent of ["first", "second", undefined, "fourth"]) note("sync next from yield*: " + show(await overSync.next(sent)));
}

async function otherNextMethods() {
  const builtinNext = Object.getPrototypeOf(count.prototype).next;
  const impostor = {
    next: builtinNext,
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  await driveFromFunction("built-in next, receiver is no generator", impostor);
  await driveFromFunction("built-in next, receiver is no generator, delegated", delegate(impostor));

  const borrowed = count("o", 2);
  const borrower = {
    next: value => builtinNext.call(borrowed, value),
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  await driveFromFunction("own next that borrows the built-in one", borrower);

  const replaced = count("p", 4);
  const seen = [];
  for await (const value of replaced) {
    seen.push(value);
    if (value === "p0") replaced.next = () => Promise.resolve({ done: true, value: "never read" });
    if (value === "p2") delete replaced.next;
  }
  note("next replaced inside the loop: " + seen.join(", "));

  const overridden = count("q", 4);
  let calls = 0;
  overridden.next = () => Promise.resolve({ done: ++calls > 2, value: "own " + calls });
  const fromOwn = [];
  for await (const value of overridden) {
    fromOwn.push(value);
    delete overridden.next;
  }
  note("own next removed inside the loop: " + fromOwn.join(", "));
}

async function keptResults() {
  const generator = count("r", 3);
  const first = await generator.next();
  const second = await generator.next();
  note(`results of next() in the source: ${first !== second}, ${show(first)}, ${show(second)}`);

  const shared = count("s", 6);
  const kept = [];
  for await (const value of shared) {
    kept.push(value);
    if (value === "s0" || value === "s2") kept.push(shared.next());
  }
  const settled = await Promise.all(kept);
  note("next() inside a loop over the same generator: " + settled.map(show).join(", "));
  const objects = settled.filter(step => typeof step === "object");
  note("kept results are distinct: " + (objects[0] !== objects[1]));
}

async function alternatingLoops() {
  const seen = [];
  async function loop(label, source) {
    for await (const value of source) {
      seen.push(label + value);
      await null;
    }
  }
  await Promise.all([loop("x:", count("t", 3)), loop("y:", countAfterAwaits("u", 3)), loop("z:", delegate(count("v", 2)))]);
  note("three loops at once: " + seen.join(", "));

  const nested = [];
  for await (const outer of count("w", 2)) {
    for await (const inner of count(outer + "/", 2)) nested.push(inner);
  }
  note("nested loops: " + nested.join(", "));
}

await drivers();
await sentValues();
await otherNextMethods();
await keptResults();
await alternatingLoops();

const atTopLevel = [];
for await (const value of count("module", 3)) atTopLevel.push(value);
for await (const value of driveFromGenerator(countAfterAwaits("module relay", 2))) atTopLevel.push(value);
for await (const value of [Promise.resolve("array 0"), "array 1"]) atTopLevel.push(value);
note("module body: " + atTopLevel.join(", "));

console.log(lines.join("\n"));
