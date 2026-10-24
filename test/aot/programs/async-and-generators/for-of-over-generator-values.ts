// for..of, destructuring and spread over generators that come in as values: real ones, changed ones, running and completed ones
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

function* upTo(n: number): Generator<number, string, unknown> {
  for (let i = 0; i < n; i++) yield i;
  return "not seen by for..of";
}
const held: any[] = [];
function hide<T>(value: T): T {
  held.push(value);
  return held.pop();
}

function sum(numbers: Iterable<number>): number {
  let total = 0;
  for (const n of numbers) total += n;
  return total;
}
function sumOfAny(numbers: any): number {
  let total = 0;
  for (const n of numbers) total += n;
  return total;
}
function firstOver(numbers: Iterable<number>, limit: number): number {
  for (const n of numbers) if (n > limit) return n;
  return -1;
}

say("sum", sum(hide(upTo(10))), sumOfAny(hide(upTo(10))), sum(hide(upTo(0))), sum(hide(upTo(1))));
say("other iterables through the same loops", sum([1, 2, 3]), sumOfAny(new Set([4, 5])), sum(new Map([[1, 2]]).keys()), sumOfAny([6].values()));
{
  const generator = hide(upTo(10));
  say("leaving early closes it", firstOver(generator, 3), generator.next());
  const started = hide(upTo(5));
  started.next();
  started.next();
  say("one that has started", sum(started), started.next());
  const completed = hide(upTo(2));
  sum(completed);
  say("one that is completed", sum(completed), firstOver(completed, 0));
}

function* guarded(log: string[]): Generator<number, void, unknown> {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    log.push("finally");
  }
}
{
  const log: string[] = [];
  say("break runs finally", firstOver(hide(guarded(log)), 1), log);
  log.length = 0;
  say("running to the end runs finally", sum(hide(guarded(log))), log);
  log.length = 0;
  attempt("a throw in the loop's body runs finally", () => {
    for (const n of hide(guarded(log))) if (n === 2) throw new Mine("from the loop's body");
  });
  say("log", log);
}
{
  function* yieldsInFinally(): Generator<number, void, unknown> {
    try {
      yield 1;
      yield 2;
    } finally {
      yield 99;
    }
  }
  const generator = hide(yieldsInFinally());
  say("finally yields while it is closed", firstOver(generator, 0), generator.next(), generator.next());
  function* throwsInFinally(): Generator<number, void, unknown> {
    try {
      yield 1;
    } finally {
      throw new Mine("from finally");
    }
  }
  attempt("finally throws while it is closed by break", () => firstOver(hide(throwsInFinally()), 0));
  attempt("the loop's own throw wins over finally's", () => {
    for (const _ of hide(throwsInFinally())) throw new Mine("from the loop's body");
  });
}

function* throwsAfter(n: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) yield i;
  throw new Mine(`the generator threw after ${n}`);
}
{
  const generator = hide(throwsAfter(3));
  attempt("the generator throws", () => sum(generator));
  say("it is completed", generator.next(), sum(generator));
  function catches(numbers: Iterable<number>): string {
    let seen = 0;
    try {
      for (const _ of numbers) seen++;
      return "ended";
    } catch (error) {
      return `caught after ${seen}: ${(error as Error).message}`;
    } finally {
      lines.push("the caller's finally ran");
    }
  }
  const second = hide(throwsAfter(2));
  say(catches(second), second.next());
  function* catchesItsOwn(): Generator<string, void, unknown> {
    try {
      throw new Mine("inside");
    } catch (error) {
      yield `caught inside: ${(error as Error).message}`;
    }
    yield "went on";
  }
  say("a throw that stays inside", [...hide(catchesItsOwn())]);
  function thrower(): never {
    throw new Mine("three frames down");
  }
  function middle(): never {
    return thrower();
  }
  function* throwsFromBelow(): Generator<number, void, unknown> {
    yield 1;
    middle();
  }
  const third = hide(throwsFromBelow());
  say(catches(third), third.next());
  function* outerLoop(inner: Iterable<number>): Generator<number, void, unknown> {
    for (const n of inner) yield n * 10;
  }
  const innermost = hide(throwsAfter(1));
  const outermost = hide(outerLoop(innermost));
  say(catches(outermost), outermost.next(), innermost.next());
}

{
  let self: Generator<number, void, unknown>;
  function* loopsOverItself(): Generator<number, void, unknown> {
    yield 1;
    for (const n of self) yield n;
  }
  self = hide(loopsOverItself());
  attempt("a generator that loops over itself", () => sum(self));
  say("then", self.next());
}
{
  const shared = hide(upTo(6));
  const pairs: number[][] = [];
  for (const a of shared) {
    for (const b of shared) {
      pairs.push([a, b]);
      if (b === 2) break;
    }
  }
  say("two loops over one generator", pairs, shared.next());
}

{
  const ownNext = hide(upTo(3));
  let calls = 0;
  (ownNext as any).next = () => ({ value: 7, done: calls++ >= 2 });
  say("its own next", sum(ownNext));
  const ownIterator = hide(upTo(3));
  (ownIterator as any)[Symbol.iterator] = () => [100, 200][Symbol.iterator]();
  say("its own Symbol.iterator", sum(ownIterator));
  const otherPrototype = hide(upTo(3));
  Object.setPrototypeOf(otherPrototype, {
    [Symbol.iterator]() {
      return [1000][Symbol.iterator]();
    },
  });
  say("another prototype", sum(otherPrototype));
  const putBack = hide(upTo(4));
  const original = Object.getPrototypeOf(putBack);
  Object.setPrototypeOf(putBack, null);
  Object.setPrototypeOf(putBack, original);
  say("its prototype put back", sum(putBack));
  const unrelated = hide(upTo(4));
  (unrelated as any).label = "x";
  say("an unrelated property", sum(unrelated));
  say("frozen", sum(Object.freeze(hide(upTo(4)))));
  const changedMeanwhile = hide(upTo(5));
  const log: unknown[] = [];
  for (const n of changedMeanwhile) {
    log.push(n);
    if (n === 1) (changedMeanwhile as any).next = () => ({ value: "never seen: next was read at the start", done: false });
    if (n === 3) {
      (changedMeanwhile as any).return = () => {
        log.push("its own return");
        return {};
      };
      break;
    }
  }
  say("next is read once, return when the loop is left", log);
}

{
  const [a, b] = hide(upTo(5));
  const [c, ...rest] = hide(upTo(4));
  const [d, e, f] = hide(upTo(2));
  say("destructuring", a, b, c, rest, d, e, f === undefined);
  const log: string[] = [];
  const [first] = hide(guarded(log));
  say("destructuring closes it", first, log);
  say("spread", [...hide(upTo(4))], Math.max(...hide(upTo(4))), Array.from(hide(upTo(3))), new Set(hide(upTo(3))).size);
}

{
  function* walk(depth: number): Generator<number, void, unknown> {
    yield depth;
    if (depth) for (const n of hide(walk(depth - 1))) yield n;
  }
  say("loops within generators, forty deep", sum(hide(walk(40))));
  function* endless(): Generator<number, void, unknown> {
    for (const n of hide(endless())) yield n;
  }
  attempt("without end", () => {
    try {
      return sum(hide(endless()));
    } catch (error) {
      return error instanceof RangeError ? "RangeError" : String(error);
    }
  });
}
{
  function* objects(n: number): Generator<{ index: number; text: string }, void, unknown> {
    for (let i = 0; i < n; i++) yield { index: i, text: `item ${i}` };
  }
  let length = 0;
  for (let round = 0; round < 20; round++) for (const item of hide(objects(5000))) length += item.text.length + (item.index & 1);
  say("many allocating steps", length);
}

console.log(lines.join("\n"));
