// yield* over compiled generators, generators that were changed, and iterators of every other kind
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
function drain(iterator: Iterator<unknown, unknown, unknown>, limit = 20) {
  const seen: unknown[] = [];
  for (let i = 0; i < limit; i++) {
    const step = iterator.next(`sent ${i}`);
    seen.push(step.done ? { returned: step.value } : step.value);
    if (step.done) break;
  }
  return seen;
}

function* three(label: string): Generator<string, string, unknown> {
  const first = yield `${label} 1`;
  const second = yield `${label} 2 after ${first}`;
  yield `${label} 3 after ${second}`;
  return `${label} is over`;
}
function* delegating(inner: Iterable<unknown>): Generator<unknown, unknown, unknown> {
  const result = yield* inner as Iterable<unknown>;
  yield ["the delegate returned", result];
  return "the outer one is over";
}

say("a compiled generator", drain(delegating(three("a"))));

function* nested(depth: number): Generator<number, number, unknown> {
  if (!depth) {
    yield 0;
    return 1;
  }
  const below = yield* nested(depth - 1);
  yield depth;
  return below + 1;
}
say("five levels", drain(nested(4)));

function* walk(tree: any): Generator<number, void, unknown> {
  if (!tree) return;
  yield* walk(tree.left);
  yield tree.value;
  yield* walk(tree.right);
}
say("a tree", [...walk({ value: 4, left: { value: 2, left: { value: 1 }, right: { value: 3 } }, right: { value: 5 } })]);

function* throwsAtSecond(): Generator<number, void, unknown> {
  yield 1;
  throw new Mine("from the inner body");
}
{
  const inner = throwsAtSecond();
  function* catching(): Generator<unknown, string, unknown> {
    try {
      yield* inner;
    } catch (error) {
      yield ["caught", (error as Error).message, "inner now", inner.next()];
    }
    return "went on";
  }
  say("the inner body throws, the outer one catches", drain(catching()));
  const second = throwsAtSecond();
  const outer = delegating(second);
  say("first", outer.next());
  attempt("the inner body throws, nobody catches", () => outer.next());
  say("both are completed", outer.next(), second.next());
}

function* guarded(log: string[]): Generator<string, string, unknown> {
  try {
    yield "in try";
    yield "still in try";
    return "ended by itself";
  } catch (error) {
    log.push(`inner caught ${error}`);
    yield "after catch";
    return "ended after catch";
  } finally {
    log.push("inner finally");
    yield "from finally";
  }
}
{
  const log: string[] = [];
  const outer = delegating(guarded(log));
  say("throw() is forwarded", outer.next(), outer.throw("thrown in"), outer.next(), outer.next(), outer.next(), outer.next(), log);
}
{
  const log: string[] = [];
  const outer = delegating(guarded(log));
  say("return() is forwarded", outer.next(), outer.return("returned in"), outer.next(), outer.next(), log);
}
{
  const outer = delegating(three("b"));
  say("return() before the start", outer.return("early"), outer.next());
  const other = delegating(three("c"));
  attempt("throw() before the start", () => other.throw(new Mine("early")));
  say("then", other.next());
}

{
  const inner = three("own next");
  (inner as any).next = function () {
    return { value: "from its own next", done: false };
  };
  say("a generator with its own next", drain(delegating(inner), 3));
}
{
  const inner = three("other prototype");
  Object.setPrototypeOf(inner, {
    next() {
      return { value: "from the other prototype", done: false };
    },
    [Symbol.iterator]() {
      return this;
    },
  });
  say("a generator with another prototype", drain(delegating(inner), 3));
}
{
  const inner = three("prototype put back");
  const original = Object.getPrototypeOf(inner);
  Object.setPrototypeOf(inner, {});
  Object.setPrototypeOf(inner, original);
  say("a generator whose prototype was put back", drain(delegating(inner)));
}
{
  const inner = three("changed meanwhile");
  const outer = delegating(inner);
  const first = outer.next();
  (inner as any).next = () => ({ value: "never seen: next was read at the start", done: false });
  (inner as any).return = (value: unknown) => ({ value: `its own return got ${value}`, done: true });
  say("next is read once, return at each use", first, outer.next("x"), outer.return("y"), outer.next());
}
{
  const inner = three("own iterator method");
  (inner as any)[Symbol.iterator] = function () {
    return ["from", "an", "array"][Symbol.iterator]();
  };
  say("a generator with its own Symbol.iterator", drain(delegating(inner)));
}
{
  const inner = three("frozen");
  Object.freeze(inner);
  say("a frozen generator", drain(delegating(inner)));
  const indexed = three("indexed");
  (indexed as any)[0] = "an element";
  say("a generator with an element", drain(delegating(indexed)));
  const unrelated = three("unrelated");
  (unrelated as any).note = "a property that has nothing to do with iteration";
  say("a generator with an unrelated property", drain(delegating(unrelated)));
}

{
  let self: Generator<unknown, unknown, unknown>;
  function* delegatesToItself(): Generator<unknown, void, unknown> {
    yield* self;
  }
  self = delegatesToItself();
  attempt("a generator that delegates to itself", () => self.next());
  say("then", self.next());
  let outer: Generator<unknown, unknown, unknown>;
  function* resumesItsDelegator(): Generator<unknown, void, unknown> {
    yield "before";
    yield outer.next();
  }
  outer = delegating(resumesItsDelegator());
  say("first", outer.next());
  attempt("a delegate that resumes its delegator", () => outer.next());
  say("then", outer.next());
}
{
  const shared = three("shared");
  const first = delegating(shared);
  const second = delegating(shared);
  say("two delegators, one delegate", first.next(), second.next(), first.next(), second.next(), first.next(), second.next(), first.next());
  const completed = three("completed");
  drain(completed);
  say("a completed delegate", drain(delegating(completed)));
}

function argumentsOf(..._: unknown[]) {
  return arguments;
}
say("an array", drain(delegating([1, 2, 3])));
say("a string", drain(delegating("añ𝒳")));
say("a Map", drain(delegating(new Map([["k", 1]]))));
say("a Set", drain(delegating(new Set(["s"]))));
say("arguments", drain(delegating(argumentsOf("p", "q") as unknown as Iterable<unknown>)));
say("a typed array", drain(delegating(new Uint8Array([7, 8]))));
say("entries of an array", drain(delegating(["e"].entries())));

class Effect {
  constructor(readonly value: number) {}
  [Symbol.iterator](): OneShot {
    return new OneShot(this);
  }
}
class OneShot {
  called = false;
  constructor(readonly self: Effect) {}
  next(sent?: number): IteratorResult<Effect, number> {
    if (this.called) return { value: sent ?? -1, done: true };
    this.called = true;
    return { value: this.self, done: false };
  }
  [Symbol.iterator](): OneShot {
    return this;
  }
}
function* program(n: number): Generator<Effect, number, number> {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += yield* new Effect(i);
  return sum;
}
{
  const iterator = program(2000);
  let step = iterator.next(0);
  let steps = 0;
  while (!step.done) {
    steps++;
    step = iterator.next(step.value.value * 2);
  }
  say("one-shot iterators", steps, step.value);
}

{
  const log: string[] = [];
  const iterable = {
    get [Symbol.iterator]() {
      log.push("get Symbol.iterator");
      return function (this: unknown) {
        log.push(`call Symbol.iterator on ${this === iterable ? "the iterable" : "something else"}`);
        let count = 0;
        return {
          get next() {
            log.push("get next");
            return function (this: unknown, sent: unknown) {
              log.push(`call next with ${sent}`);
              const now = count++;
              return {
                get done() {
                  log.push("get done");
                  return now === 2 ? "truthy" : 0;
                },
                get value() {
                  log.push("get value");
                  return now;
                },
              };
            };
          },
          get return() {
            log.push("get return");
            return undefined;
          },
          get throw() {
            log.push("get throw");
            return undefined;
          },
        };
      };
    },
  };
  say("the order of what is observable", drain(delegating(iterable as unknown as Iterable<unknown>)), log);
  log.length = 0;
  const returned = delegating(iterable as unknown as Iterable<unknown>);
  say("return() where the iterator has none", returned.next(), returned.return("r"), returned.next(), log);
  log.length = 0;
  const thrown = delegating(iterable as unknown as Iterable<unknown>);
  thrown.next();
  attempt("throw() where the iterator has none", () => thrown.throw("t"));
  say("log", log);
}

for (const [title, value] of [
  ["undefined", undefined],
  ["null", null],
  ["a plain object", {}],
  ["Symbol.iterator is a number", { [Symbol.iterator]: 1 }],
  ["Symbol.iterator returns a number", { [Symbol.iterator]: () => 1 }],
  ["Symbol.iterator returns null", { [Symbol.iterator]: () => null }],
  ["Symbol.iterator returns a function", { [Symbol.iterator]: () => () => 1 }],
  ["Symbol.iterator throws", { [Symbol.iterator]: () => { throw new Mine("while opening"); } }],
  ["next is missing", { [Symbol.iterator]: () => ({}) }],
  ["next is true", { [Symbol.iterator]: () => ({ next: true }) }],
  ["next returns a number", { [Symbol.iterator]: () => ({ next: () => 1 }) }],
  ["next returns undefined", { [Symbol.iterator]: () => ({ next: () => undefined }) }],
  ["next throws", { [Symbol.iterator]: () => ({ next: () => { throw new Mine("while stepping"); } }) }],
] as [string, unknown][])
  attempt(title, () => delegating(value as Iterable<unknown>).next());

class Range {
  constructor(readonly from: number, readonly to: number) {}
  *[Symbol.iterator](): Generator<number, string, unknown> {
    for (let i = this.from; i < this.to; i++) yield i;
    return "range is over";
  }
}
say("a class whose Symbol.iterator is a generator method", drain(delegating(new Range(3, 6))));

function* forever(): Generator<never, never, unknown> {
  yield* forever();
  throw new Mine("not reached");
}
attempt("delegation without end", () => {
  try {
    forever().next();
    return "returned";
  } catch (error) {
    return error instanceof RangeError ? "RangeError" : String(error);
  }
});

{
  let total = 0;
  function* chunk(base: number): Generator<number, number, unknown> {
    yield base;
    yield base + 1;
    yield base + 2;
    return 3;
  }
  function* many(n: number): Generator<number, number, unknown> {
    let made = 0;
    for (let i = 0; i < n; i += 3) made += yield* chunk(i);
    return made;
  }
  const iterator = many(30000);
  for (let step = iterator.next(); ; step = iterator.next()) {
    if (step.done) {
      say("many short delegates", total, step.value);
      break;
    }
    total += step.value;
  }
}

console.log(lines.join("\n"));
