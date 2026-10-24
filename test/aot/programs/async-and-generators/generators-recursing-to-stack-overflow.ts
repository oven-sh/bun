// Generators that make and step generators of their own kind until the stack is full. However a body reaches the next one (next(), yield*, for-of, a spread, a pattern, through a plain function),
// the recursion ends in one RangeError that passes through every frame: each finally runs, each generator that was running is completed afterwards, and the program goes on. How deep the stack is
// differs from one way of running the program to another, so no line depends on the depth. The time behind a line is not compared.
// The program counts the entries of the two operations behind the creation of a generator, which only the jsc shell can.
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entries(): number {
  return counted ? counted("operationAOTNewGenerator") + counted("operationAOTSaveFrameAndYield") : 0;
}
const lines: string[] = [];
const deep = 300;
let entered = 0;
let left = 0;
type Numbers = Generator<number, number, unknown>;
type NumbersLater = AsyncGenerator<number, number, unknown>;

function nameOf(error: unknown): string {
  return error instanceof RangeError ? "RangeError" : "another error: " + String(error);
}
function last(generator: Numbers): number {
  for (;;) {
    const step = generator.next();
    if (step.done) return step.value;
  }
}
function report(label: string, outcome: string, entriesBefore: number, start: number): void {
  const made = entries() - entriesBefore;
  const elapsed = Math.round(performance.now() - start);
  lines.push(label + ": " + outcome + ", went deep: " + (entered > deep) + ", " + (made * 20 < entered ? "few entries" : made + " ENTRIES FOR " + entered + " GENERATORS") + " " + elapsed + "ms");
}
function attempt(label: string, run: () => unknown): void {
  entered = 0;
  left = 0;
  const entriesBefore = entries();
  const start = performance.now();
  let outcome: string;
  try {
    outcome = "returned " + String(run());
  } catch (error) {
    outcome = nameOf(error);
  }
  report(label, outcome, entriesBefore, start);
}
async function attemptLater(label: string, run: () => Promise<unknown>): Promise<void> {
  entered = 0;
  left = 0;
  const entriesBefore = entries();
  const start = performance.now();
  let outcome: string;
  try {
    outcome = "returned " + String(await run());
  } catch (error) {
    outcome = nameOf(error);
  }
  report(label, outcome, entriesBefore, start);
}

function* byNext(): Numbers {
  entered++;
  return byNext().next().value;
}
function* byYieldStar(): Numbers {
  entered++;
  return yield* byYieldStar();
}
function* byForOf(): Numbers {
  entered++;
  for (const value of byForOf()) yield value;
  return 0;
}
function* bySpread(): Numbers {
  entered++;
  return [...bySpread()].length;
}
function* byPattern(): Numbers {
  entered++;
  const [first] = byPattern();
  return first;
}
function* byArrayFrom(): Numbers {
  entered++;
  return Array.from(byArrayFrom()).length;
}
function stepsTheNext(): number {
  return last(throughAPlainFunction()) + 1;
}
function* throughAPlainFunction(): Numbers {
  entered++;
  return stepsTheNext() + 1;
}
function* one(): Numbers {
  entered++;
  return other().next().value;
}
function* other(): Numbers {
  return yield* one();
}
class Walker {
  steps = 0;
  *walk(): Numbers {
    entered++;
    this.steps++;
    return yield* this.walk();
  }
}
function* takesArguments(a: number, b: string, c: number[]): Numbers {
  entered++;
  return (yield* takesArguments(a + 1, b, c)) + a + b.length + c.length;
}
function* keepsValues(seed: number): Numbers {
  entered++;
  const a = seed + 1, b = seed * 0.5, c = "c" + (seed % 10), d = [seed];
  const below = keepsValues(a).next().value;
  return below + a + b + c.length + d.length;
}
function* hasAFinally(): Numbers {
  try {
    entered++;
    return yield* hasAFinally();
  } finally {
    left++;
  }
}
function* catchesAndRethrows(): Numbers {
  try {
    entered++;
    return catchesAndRethrows().next().value;
  } catch (error) {
    left++;
    throw error;
  }
}
function* yieldsFirst(): Numbers {
  yield 1;
  return yield* byYieldStar();
}
const kept: Numbers[] = [];
function* keepsTheFirstOnes(): Numbers {
  entered++;
  const inner = keepsTheFirstOnes();
  if (kept.length < 5) kept.push(inner);
  return inner.next().value;
}
// Some frame near the end of the stack has room enough to catch the error. Which one it is differs, and so does how often that happens on the way back.
function* recovers(): Generator<string, string, unknown> {
  entered++;
  try {
    return yield* recovers();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    yield "caught";
    return "went on";
  }
}
function* range(count: number): Numbers {
  for (let i = 0; i < count; i++) yield i;
  return count;
}

async function* laterByForAwait(): NumbersLater {
  entered++;
  for await (const value of laterByForAwait()) yield value;
  return 0;
}
async function* laterByYieldStar(): NumbersLater {
  entered++;
  return yield* laterByYieldStar();
}
async function* laterByNext(): NumbersLater {
  entered++;
  return (await laterByNext().next()).value;
}
async function* laterWithAFinally(): NumbersLater {
  try {
    entered++;
    for await (const value of laterWithAFinally()) yield value;
    return 0;
  } finally {
    left++;
  }
}
async function firstOf(stream: NumbersLater): Promise<number> {
  for await (const value of stream) return value;
  return -1;
}

attempt("next()", () => last(byNext()));
attempt("yield*", () => last(byYieldStar()));
attempt("for-of", () => last(byForOf()));
attempt("a spread", () => last(bySpread()));
attempt("a pattern", () => last(byPattern()));
attempt("Array.from", () => last(byArrayFrom()));
attempt("a plain function between the generators", () => last(throughAPlainFunction()));
attempt("two generator functions", () => last(one()));
const walker = new Walker();
attempt("a method", () => last(walker.walk()));
lines.push("the method counted its calls: " + (walker.steps === entered));
attempt("with arguments", () => last(takesArguments(0, "text", [1, 2])));
attempt("with values that are used behind the step", () => last(keepsValues(0)));
attempt("stepped by for-of from outside", () => {
  let sum = 0;
  for (const value of byForOf()) sum += value;
  return sum;
});
attempt("with a finally in every frame", () => last(hasAFinally()));
lines.push("every finally ran: " + (left === entered));
attempt("with a catch that throws again in every frame", () => last(catchesAndRethrows()));
lines.push("every catch ran: " + (left === entered));
attempt("a generator that has yielded before", () => {
  const generator = yieldsFirst();
  const first = generator.next();
  try {
    generator.next();
    return "no error";
  } catch (error) {
    const after = generator.next();
    return [first.value, first.done, nameOf(error), after.value, after.done].join(" ");
  }
});
attempt("the generators that were running are completed", () => {
  kept.length = 0;
  const outermost = keepsTheFirstOnes();
  let outcome: string;
  try {
    outcome = "returned " + last(outermost);
  } catch (error) {
    outcome = nameOf(error);
  }
  return outcome + ", then " + [outermost, ...kept].map(generator => { const step = generator.next(); return step.done + " " + step.value; }).join(", ");
});
attempt("caught near the end of the stack", () => {
  const generator = recovers();
  let caught = 0;
  let step = generator.next();
  while (!step.done) {
    if (step.value === "caught") caught++;
    step = generator.next();
  }
  return (caught > 0 ? "caught, " : "NOT CAUGHT, ") + step.value;
});
attempt("five times", () => {
  let errors = 0;
  for (let round = 0; round < 5; round++) {
    try {
      last(round % 2 ? byYieldStar() : byNext());
    } catch (error) {
      if (error instanceof RangeError) errors++;
    }
  }
  return errors + " errors";
});
attempt("in a callback of a built-in", () => [0].map(() => { try { return last(byNext()); } catch (error) { return nameOf(error); } }).join());
lines.push("what ends, ends: " + [...range(5)].join() + " " + last(range(3)));

await attemptLater("behind an await", async () => {
  await null;
  return last(byNext());
});
await attemptLater("in a then handler", () => Promise.resolve().then(() => last(byYieldStar())));
await attemptLater("in a timer callback", () => new Promise<number>((resolve, reject) => {
  setTimeout(() => {
    try {
      resolve(last(byForOf()));
    } catch (error) {
      reject(error);
    }
  }, 0);
}));
await attemptLater("async generators, for await", () => firstOf(laterByForAwait()));
await attemptLater("async generators, yield*", () => firstOf(laterByYieldStar()));
await attemptLater("async generators, next()", () => firstOf(laterByNext()));
await attemptLater("async generators, behind an await", async () => {
  await null;
  return await firstOf(laterByForAwait());
});
await attemptLater("async generators with a finally in every frame", () => firstOf(laterWithAFinally()));
lines.push("every finally ran: " + (left === entered));
await attemptLater("an async generator is completed afterwards", async () => {
  const stream = laterByForAwait();
  let outcome: string;
  try {
    outcome = "returned " + (await stream.next()).value;
  } catch (error) {
    outcome = nameOf(error);
  }
  const after = await stream.next();
  return outcome + ", then " + after.done + " " + after.value;
});
attempt("and once more without an await", () => last(byNext()));
console.log(lines.join("\n"));

export {};
