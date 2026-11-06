// Three thousand generators, each stepping the next, and the innermost one throws: one error passes through three thousand frames, far from the end of the stack. It arrives as the value that was
// thrown, every finally runs, innermost first, every generator is completed afterwards, and the function that catches it finds its own values as they were. The same for frames that have been
// suspended before and are resumed for the throw, for throw() and return() sent in from outside, and for async generators. Beside each chain that throws stands the same chain that returns, so that
// the times behind the lines, which are not compared, tell the cost of the throw from the cost of making and stepping the generators.
// The program counts the entries of the two operations behind the creation of a generator, which only the jsc shell can.
// Env: JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
function entries(): number {
  return counted ? counted("operationAOTNewGenerator") + counted("operationAOTSaveFrameAndYield") : 0;
}
const lines: string[] = [];
const frames = 3_000;
const rounds = 2;
type Numbers = Generator<number, number, unknown>;
type NumbersLater = AsyncGenerator<number, number, unknown>;
class Failure extends Error {
  constructor(readonly code: number) {
    super("failure " + code);
  }
}

let state = 20261019;
function draw(): number {
  state = (state * 48271) % 2147483647;
  return state % 1000;
}
let made = 0;
let cleaned = 0;
let lastCleaned = -1;
let outOfOrder = 0;
let isThrowing = false;
let thrownValue: unknown = undefined;
function bottom(): number {
  if (isThrowing) throw thrownValue;
  return 0;
}
function cleanUp(depth: number): void {
  cleaned++;
  if (depth !== lastCleaned + 1) outOfOrder++;
  lastCleaned = depth;
}
function last(generator: Numbers): number {
  for (;;) {
    const step = generator.next();
    if (step.done) return step.value;
  }
}
function describe(value: unknown): string {
  if (value instanceof Error) return value.name + " (" + value.message + ")";
  return typeof value + " " + String(value);
}

function* byNext(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  return byNext(depth - 1).next().value + 1;
}
function* byYieldStar(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  return (yield* byYieldStar(depth - 1)) + 1;
}
function* byForOf(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  for (const value of byForOf(depth - 1)) yield value;
  return depth;
}
function* bySpread(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  return [...bySpread(depth - 1)].length + depth;
}
function stepsTheNext(depth: number): number {
  return last(throughPlainFunctions(depth)) + 1;
}
function* throughPlainFunctions(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  return stepsTheNext(depth - 1) + 1;
}
class Walker {
  constructor(readonly step: number) {}
  *walk(depth: number): Numbers {
    made++;
    if (!depth) return bottom();
    return (yield* this.walk(depth - 1)) + this.step;
  }
}
const walker = new Walker(2);
function* keepsValues(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  const a = depth + 1, b = depth * 0.5, c = "c" + (depth % 10), d = [depth];
  const below = keepsValues(depth - 1).next().value;
  return (below + a + b + c.length + d.length) % 1009;
}
function* hasAFinally(depth: number): Numbers {
  made++;
  try {
    if (!depth) return bottom();
    return (yield* hasAFinally(depth - 1)) + 1;
  } finally {
    cleanUp(depth);
  }
}
function* hasAFinallyAroundNext(depth: number): Numbers {
  made++;
  try {
    if (!depth) return bottom();
    return hasAFinallyAroundNext(depth - 1).next().value + 1;
  } finally {
    cleanUp(depth);
  }
}
function* catchesAndRethrows(depth: number): Numbers {
  made++;
  try {
    if (!depth) return bottom();
    return catchesAndRethrows(depth - 1).next().value + 1;
  } catch (error) {
    cleanUp(depth);
    throw error;
  }
}
function* everyTenthHasAFinally(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  if (depth % 10) return (yield* everyTenthHasAFinally(depth - 1)) + 1;
  try {
    return (yield* everyTenthHasAFinally(depth - 1)) + 1;
  } finally {
    cleaned++;
  }
}

// The function that catches holds values of its own across the whole descent.
function catches(start: (depth: number) => Numbers, depth: number): string {
  const a = draw(), b = draw(), c = draw(), d = draw() / 8, e = "e" + draw(), f = { n: draw() }, g = draw(), h = draw() / 16;
  const before = [a, b, c, d, e, f.n, g, h].join();
  let outcome: string;
  try {
    outcome = "returned " + last(start(depth));
  } catch (error) {
    outcome = "caught " + describe(error) + (error === thrownValue ? "" : ", WHICH IS NOT WHAT WAS THROWN");
  }
  const after = [a, b, c, d, e, f.n, g, h].join();
  return before === after ? outcome : outcome + ", THE VALUES OF THE CATCHER CHANGED FROM " + before + " TO " + after;
}
const endings: [ending: string, make: (() => unknown) | null][] = [
  ["returns", null],
  ["throws an error", () => new Failure(1)],
  ["throws a string", () => "a string"],
  ["throws undefined", () => undefined],
];
function reset(make: (() => unknown) | null): void {
  isThrowing = make !== null;
  thrownValue = make ? make() : undefined;
  lastCleaned = -1;
}
function counts(entriesBefore: number, start: number): string {
  const inRuntime = entries() - entriesBefore;
  const elapsed = Math.round(performance.now() - start);
  return made + " generators" + (cleaned ? ", " + cleaned + " cleaned up, " + outOfOrder + " out of order" : "") + ", " + (inRuntime < 5 + made / 20 ? "few entries" : inRuntime + " ENTRIES") + " " + elapsed + "ms";
}
function clearCounts(): void {
  made = 0;
  cleaned = 0;
  outOfOrder = 0;
}
function measure(label: string, depth: number, start: (depth: number) => Numbers, numberOfEndings: number = 2): void {
  for (const [ending, make] of endings.slice(0, numberOfEndings)) {
    clearCounts();
    const entriesBefore = entries();
    const begin = performance.now();
    const outcomes = new Set<string>();
    for (let round = 0; round < rounds; round++) {
      reset(make);
      outcomes.add(catches(start, depth));
    }
    lines.push(label + ", the innermost " + ending + ": " + [...outcomes].join(" / ") + ", " + counts(entriesBefore, begin));
  }
}

// Every frame of these chains is suspended once, by a yield of the innermost generator, before the step that ends the chain.
function* yieldsFirst(depth: number): Numbers {
  made++;
  if (!depth) {
    yield 0;
    return bottom();
  }
  return (yield* yieldsFirst(depth - 1)) + 1;
}
function* yieldsFirstInATry(depth: number): Numbers {
  made++;
  try {
    if (!depth) {
      yield 0;
      return bottom();
    }
    return (yield* yieldsFirstInATry(depth - 1)) + 1;
  } finally {
    cleanUp(depth);
  }
}
function* yieldsFirstThroughForOf(depth: number): Numbers {
  made++;
  if (!depth) {
    yield 0;
    return bottom();
  }
  for (const value of yieldsFirstThroughForOf(depth - 1)) yield value;
  return depth;
}
function show(step: IteratorResult<number, number>): string {
  return (step.done ? "returned " : "yielded ") + step.value;
}
function attempt(run: () => IteratorResult<number, number>): string {
  const a = draw(), b = draw(), c = draw() / 8, d = "d" + draw();
  const before = [a, b, c, d].join();
  let outcome: string;
  try {
    outcome = show(run());
  } catch (error) {
    outcome = "caught " + describe(error) + (error === thrownValue ? "" : ", WHICH IS NOT WHAT WAS THROWN");
  }
  return before === [a, b, c, d].join() ? outcome : outcome + ", THE VALUES OF THE CATCHER CHANGED";
}
function measureSuspended(label: string, start: (depth: number) => Numbers): void {
  const ways: [way: string, make: (() => unknown) | null, end: (generator: Numbers) => IteratorResult<number, number>][] = [
    ["is resumed and returns", null, generator => generator.next()],
    ["is resumed and throws", () => new Failure(2), generator => generator.next()],
    ["gets throw() from outside", () => new Failure(3), generator => generator.throw(thrownValue)],
    ["gets throw() of a string from outside", () => "a string", generator => generator.throw(thrownValue)],
    ["gets return() from outside", null, generator => generator.return(-5)],
  ];
  for (const [way, make, end] of ways) {
    clearCounts();
    const entriesBefore = entries();
    const begin = performance.now();
    const outcomes = new Set<string>();
    for (let round = 0; round < rounds; round++) {
      reset(make);
      const generator = start(frames);
      outcomes.add(show(generator.next()) + ", then " + attempt(() => end(generator)) + ", then " + show(generator.next()));
    }
    lines.push(label + ", the innermost " + way + ": " + [...outcomes].join(" / ") + ", " + counts(entriesBefore, begin));
  }
}

const kept: Numbers[] = [];
function* keepsSome(depth: number): Numbers {
  made++;
  if (!depth) return bottom();
  const inner = keepsSome(depth - 1);
  if (depth % 500 === 1) kept.push(inner);
  return inner.next().value + 1;
}
// A generator in the middle catches, and the frames above it go on as if nothing had happened.
function* oneCatches(depth: number, catcher: number): Numbers {
  made++;
  if (!depth) return bottom();
  if (depth !== catcher) return (yield* oneCatches(depth - 1, catcher)) + 1;
  try {
    return (yield* oneCatches(depth - 1, catcher)) + 1;
  } catch (error) {
    return error === thrownValue ? -1000 : -2000;
  }
}

async function* laterByForAwait(depth: number): NumbersLater {
  made++;
  try {
    if (!depth) return bottom();
    for await (const value of laterByForAwait(depth - 1)) yield value;
    return depth;
  } finally {
    cleanUp(depth);
  }
}
async function* laterByYieldStar(depth: number): NumbersLater {
  made++;
  if (!depth) return bottom();
  return (yield* laterByYieldStar(depth - 1)) + 1;
}
async function* laterBehindAnAwait(depth: number): NumbersLater {
  made++;
  if (!depth) {
    await null;
    return bottom();
  }
  return (await laterBehindAnAwait(depth - 1).next()).value + 1;
}
async function measureLater(label: string, depth: number, start: (depth: number) => NumbersLater): Promise<void> {
  for (const [ending, make] of endings) {
    clearCounts();
    const entriesBefore = entries();
    const begin = performance.now();
    const outcomes = new Set<string>();
    for (let round = 0; round < rounds; round++) {
      reset(make);
      const a = draw(), b = draw() / 8, c = "c" + draw();
      const before = [a, b, c].join();
      const stream = start(depth);
      let outcome: string;
      try {
        let step = await stream.next();
        while (!step.done) step = await stream.next();
        outcome = "returned " + step.value;
      } catch (error) {
        outcome = "caught " + describe(error) + (error === thrownValue ? "" : ", WHICH IS NOT WHAT WAS THROWN");
      }
      const after = await stream.next();
      outcomes.add(outcome + ", then " + after.done + " " + after.value + (before === [a, b, c].join() ? "" : ", THE VALUES OF THE CATCHER CHANGED"));
    }
    lines.push(label + ", the innermost " + ending + ": " + [...outcomes].join(" / ") + ", " + counts(entriesBefore, begin));
  }
}

lines.push("== frames that are entered for the first time");
measure("next()", frames, byNext, endings.length);
measure("yield*", frames, byYieldStar, endings.length);
measure("for-of", frames, byForOf);
measure("a spread, 300 frames", 300, bySpread);
measure("a plain function between the generators", frames, throughPlainFunctions);
measure("a method", frames, depth => walker.walk(depth));
measure("values that are used behind the step", frames, keepsValues);
measure("a finally in every frame, yield*", frames, hasAFinally);
measure("a finally in every frame, next()", frames, hasAFinallyAroundNext);
measure("a catch that throws again in every frame", frames, catchesAndRethrows);
measure("a finally in every tenth frame", frames, everyTenthHasAFinally);
for (const depth of [0, 1, 2, 3, 10, 100]) measure(depth + " frames above the innermost", depth, hasAFinally, endings.length);
lines.push("== frames that have been suspended");
measureSuspended("yield*", yieldsFirst);
measureSuspended("yield* in a try", yieldsFirstInATry);
measureSuspended("for-of", yieldsFirstThroughForOf);
lines.push("== afterwards");
clearCounts();
reset(() => new Failure(4));
kept.length = 0;
lines.push("some of the generators are kept: " + catches(keepsSome, frames) + ", then " + kept.map(generator => show(generator.next())).join(", "));
for (const catcher of [1, 2, 1_500, frames - 1, frames]) {
  reset(() => new Failure(5));
  lines.push("the generator " + catcher + " above the innermost catches: " + catches(depth => oneCatches(depth, catcher), frames));
}
lines.push("== async generators, 500 frames");
await measureLater("for await in a try", 500, laterByForAwait);
await measureLater("yield*", 500, laterByYieldStar);
await measureLater("next(), the innermost behind an await", 500, laterBehindAnAwait);
console.log(lines.join("\n"));

export {};
