// next(), return() and throw() where the receiver is declared as a Generator: real generators, changed ones and look-alikes
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}
class Mine extends Error {}
function attempt(title: string, run: () => unknown) {
  try {
    say(title, "->", run());
  } catch (error) {
    say(title, "threw", error instanceof Mine ? error.message : error instanceof Error ? error.constructor.name : error);
  }
}

class Task {
  constructor(readonly cost: number) {}
}
type Program = Generator<Task, number, number>;

function* tasks(n: number): Program {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += yield new Task(i);
  return sum;
}

function drive(iterator: Program): number {
  let step = iterator.next(0);
  while (!step.done) step = iterator.next(step.value.cost * 2);
  return step.value;
}
function driveWithConstants(iterator: Program): number {
  let turns = 0;
  for (;;) {
    const step = iterator.next(1);
    if (step.done) return step.value + turns;
    turns++;
  }
}
function driveByDestructuring(iterator: Program): number {
  for (;;) {
    const { value, done } = iterator.next(3);
    if (done) return value as number;
  }
}
function firstValue(iterator: Program): unknown {
  return iterator.next(0).value;
}
function isOverAtOnce(iterator: Program): boolean | undefined {
  return iterator.next(0).done;
}
function valueOfCompleted(iterator: Generator<Task, number | undefined, number>): unknown {
  const step = iterator.next(0);
  return [step.done, step.value];
}
function keepsResults(iterator: Program): IteratorResult<Task, number>[] {
  const kept: IteratorResult<Task, number>[] = [];
  for (;;) {
    const step = iterator.next(5);
    kept.push(step);
    if (step.done) return kept;
  }
}
function returnsResult(iterator: Program): IteratorResult<Task, number> {
  return iterator.next(0);
}
function comparesResults(iterator: Program): boolean {
  const first = iterator.next(0);
  const second = iterator.next(0);
  return (first as unknown) === second;
}

say("drive", drive(tasks(10)), drive(tasks(0)));
say("constants", driveWithConstants(tasks(4)));
say("destructuring", driveByDestructuring(tasks(4)));
say("first value", firstValue(tasks(1)), firstValue(tasks(0)));
say("over at once", isOverAtOnce(tasks(1)), isOverAtOnce(tasks(0)));
say("results that are kept", keepsResults(tasks(2)));
{
  const result = returnsResult(tasks(1));
  say("a result that is returned", result, Object.keys(result), Object.getPrototypeOf(result) === Object.prototype, Object.getOwnPropertyDescriptor(result, "done"));
  (result as any).extra = 1;
  say("it is an ordinary object", result);
}
say("two results are two objects", comparesResults(tasks(3)));
{
  const completed = tasks(1);
  drive(completed);
  say("a completed generator", isOverAtOnce(completed), valueOfCompleted(completed));
}

function lookAlike(log: string[]): Program {
  let count = 0;
  return {
    next(sent: number) {
      log.push(`next(${sent})`);
      const now = count++;
      return {
        get done() {
          log.push("get done");
          return now >= 2;
        },
        get value() {
          log.push("get value");
          return now >= 2 ? 100 : new Task(now);
        },
      };
    },
    return(value: number) {
      log.push(`return(${value})`);
      return { value, done: true };
    },
    throw(error: unknown) {
      log.push(`throw(${error})`);
      return { value: -1, done: true };
    },
    [Symbol.iterator]() {
      return this;
    },
  } as unknown as Program;
}
for (const [title, run] of [
  ["drive", drive],
  ["constants", driveWithConstants],
  ["destructuring", driveByDestructuring],
  ["first value", firstValue],
  ["over at once", isOverAtOnce],
] as [string, (iterator: Program) => unknown][]) {
  const log: string[] = [];
  say("a look-alike:", title, run(lookAlike(log)), log);
}
for (const [title, value] of [
  ["undefined", undefined],
  ["null", null],
  ["a number", 1],
  ["an object without next", {}],
  ["next is not a function", { next: 1 }],
  ["next returns undefined", { next: () => undefined }],
  ["next returns a number", { next: () => 1 }],
] as [string, unknown][])
  attempt(`declared as a generator: ${title}`, () => drive(value as Program));

{
  const changed = tasks(3);
  (changed as any).next = function (sent: number) {
    return { value: sent + 1000, done: true };
  };
  say("its own next", drive(changed));
  const inherits = tasks(3);
  Object.setPrototypeOf(inherits, { next: (sent: number) => ({ value: sent + 2000, done: true }) });
  say("another prototype", drive(inherits));
  const putBack = tasks(3);
  const original = Object.getPrototypeOf(putBack);
  Object.setPrototypeOf(putBack, null);
  Object.setPrototypeOf(putBack, original);
  say("its prototype put back", drive(putBack));
  const unrelated = tasks(3);
  (unrelated as any).label = "x";
  say("an unrelated property", drive(unrelated));
  const frozen = Object.freeze(tasks(3));
  say("frozen", drive(frozen));
}
{
  const iterator = tasks(5);
  function changesItWhileTheArgumentIsEvaluated(): number {
    (iterator as any).next = () => ({ value: -5, done: true });
    return 7;
  }
  function steps(generator: Program): unknown[] {
    return [generator.next(0).done, generator.next(changesItWhileTheArgumentIsEvaluated()).done, generator.next(0).value];
  }
  say("the method is read before the argument is evaluated", steps(iterator));
}

function* guarded(log: string[]): Generator<string, string, unknown> {
  try {
    const got = yield "in try";
    log.push(`got ${got}`);
    yield "still in try";
    return "ended by itself";
  } catch (error) {
    log.push(`caught ${error}`);
    yield "after catch";
    return "ended after catch";
  } finally {
    log.push("finally");
    yield "from finally";
  }
}
function returnsEarly(iterator: Generator<string, string, unknown>): unknown[] {
  const seen: unknown[] = [iterator.next().value];
  const returned = iterator.return("asked to return");
  seen.push(returned.done, returned.value);
  const after = iterator.next();
  seen.push(after.done, after.value, iterator.next().done);
  return seen;
}
function throwsIn(iterator: Generator<string, string, unknown>): unknown[] {
  const seen: unknown[] = [iterator.next().value];
  const thrown = iterator.throw("thrown in");
  seen.push(thrown.done, thrown.value);
  for (;;) {
    const step = iterator.next();
    seen.push(step.value);
    if (step.done) return seen;
  }
}
{
  const log: string[] = [];
  say("return()", returnsEarly(guarded(log)), log);
  log.length = 0;
  say("throw()", throwsIn(guarded(log)), log);
}
function returnsBeforeTheStart(iterator: Program): unknown[] {
  const returned = iterator.return(9);
  return [returned.done, returned.value, iterator.next(0).done];
}
function throwsBeforeTheStart(iterator: Program): unknown {
  return iterator.throw(new Mine("before the start")).done;
}
say("return() before the start", returnsBeforeTheStart(tasks(2)));
{
  const iterator = tasks(2);
  attempt("throw() before the start", () => throwsBeforeTheStart(iterator));
  say("then", isOverAtOnce(iterator));
}

function* throwsAt(n: number): Program {
  for (let i = 0; i < n; i++) yield new Task(i);
  throw new Mine(`the body threw after ${n}`);
}
{
  const iterator = throwsAt(2);
  attempt("the body throws", () => drive(iterator));
  say("it is completed", isOverAtOnce(iterator), valueOfCompleted(iterator));
  function catches(generator: Program): string {
    try {
      for (;;) {
        const step = generator.next(0);
        if (step.done) return "ended";
      }
    } catch (error) {
      return `caught in the caller: ${(error as Error).message}; then done is ${generator.next(0).done}`;
    } finally {
      lines.push("the caller's finally ran");
    }
  }
  say(catches(throwsAt(1)));
}
{
  let self: Program;
  function* resumesItself(): Program {
    yield new Task(1);
    const step = self.next(0);
    return step.done ? 1 : 0;
  }
  self = resumesItself();
  say("first", firstValue(self));
  attempt("a generator that resumes itself", () => drive(self));
  say("then", isOverAtOnce(self));
}
{
  function* stackOf(): Generator<string, void, unknown> {
    yield (new Error("inside").stack ?? "").split("\n").length > 1 ? "has a stack" : "no stack";
  }
  function first(iterator: Generator<string, void, unknown>) {
    return iterator.next().value;
  }
  say("an error made in the body", first(stackOf()));
}
{
  function* deep(n: number): Generator<number, number, unknown> {
    if (!n) return 0;
    const inner = deep(n - 1);
    const step = inner.next();
    yield n;
    return step.done ? step.value + 1 : -1;
  }
  function last(iterator: Generator<number, number, unknown>): number {
    for (;;) {
      const step = iterator.next();
      if (step.done) return step.value;
    }
  }
  say("generators that step generators", last(deep(50)));
  function* endless(): Generator<number, number, unknown> {
    return endless().next().value as number;
  }
  attempt("without end", () => {
    try {
      return last(endless());
    } catch (error) {
      return error instanceof RangeError ? "RangeError" : String(error);
    }
  });
}
{
  let total = 0;
  for (let round = 0; round < 300; round++) total += drive(tasks(100));
  say("many steps", total);
}

console.log(lines.join("\n"));
