// [...x] where x is a generator or an object that a user wrote
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
const kept: any[] = [];
function hide<T>(value: T): T {
  kept.push(value);
  return kept.pop();
}
function all(values: Iterable<unknown>): unknown[] {
  return [...values];
}
function around(values: Iterable<unknown>): unknown[] {
  return ["before", ...values, "between", ...values, "after"];
}
function allOfAny(values: any): unknown[] {
  return [...values];
}
function* upTo(n: number): Generator<number, string, unknown> {
  for (let i = 0; i < n; i++) yield i;
  return "not part of the spread";
}
function* mixed(): Generator<unknown, void, unknown> {
  yield 1;
  yield 1.5;
  yield "text";
  yield undefined;
  yield null;
  yield { a: 1 };
  yield [2];
  yield NaN;
  yield -0;
  yield 2 ** 40;
}
function counting(to: number) {
  let at = 0;
  return { next: () => (at < to ? { value: at++, done: false } : { value: undefined, done: true }) };
}
class Range {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
  [Symbol.iterator]() {
    let at = this.from;
    const to = this.to;
    return { next: () => (at < to ? { value: at++, done: false } : { value: undefined, done: true }) };
  }
}
class Walk {
  constructor(readonly items: string[]) {}
  *[Symbol.iterator](): Generator<string, void, unknown> {
    for (const item of this.items) yield item.toUpperCase();
  }
}
say("a generator", all(hide(upTo(5))), all(hide(upTo(0))), allOfAny(hide(upTo(2))));
say("values of every kind", all(hide(mixed())), Object.is((all(hide(mixed())) as number[])[8], -0));
say("numbers, then doubles", all(hide((function* () { yield 1; yield 2; yield 2.5; yield 3; })())));
say("doubles, then a string", all(hide((function* () { yield 0.5; yield "s"; })())));
say("around", around(hide(new Range(0, 2))), around(hide(upTo(2))));
say("a class", all(new Range(3, 6)), all(new Walk(["a", "b"])), allOfAny(new Walk([])));
say("an object", all({ [Symbol.iterator]: () => counting(3) }));
{
  const started = hide(upTo(4));
  started.next();
  say("one that has started", all(started), all(started));
  const changed = hide(upTo(4));
  (changed as any).next = () => ({ done: true });
  say("its own next", all(changed));
  const other = hide(upTo(4));
  Object.setPrototypeOf(other, { [Symbol.iterator]: () => counting(1) });
  say("another prototype", all(other));
}
{
  const log: string[] = [];
  function* guarded(): Generator<number, void, unknown> {
    try {
      yield 1;
      throw new Mine("from the body");
    } finally {
      log.push("finally");
    }
  }
  attempt("the body throws", () => all(hide(guarded())));
  say("log", log);
  attempt("next throws; return is not called", () =>
    all({
      [Symbol.iterator]: () => ({
        next() {
          throw new Mine("from next");
        },
        return() {
          log.push("return was called");
          return { value: undefined, done: true };
        },
      }),
    }),
  );
  say("log", log);
  let self: Generator<unknown, void, unknown>;
  function* spreadsItself(): Generator<unknown, void, unknown> {
    yield [...self];
  }
  self = spreadsItself();
  attempt("a generator that spreads itself", () => all(self));
}
for (const [title, value] of [
  ["a plain object", {}],
  ["Symbol.iterator is a number", { [Symbol.iterator]: 1 }],
  ["it returns a number", { [Symbol.iterator]: () => 1 }],
  ["next is missing", { [Symbol.iterator]: () => ({}) }],
  ["next returns a number", { [Symbol.iterator]: () => ({ next: () => 1 }) }],
] as [string, unknown][])
  attempt(title, () => allOfAny(value));
{
  const log: string[] = [];
  let count = 0;
  say(
    "the order of what is observable",
    all({
      get [Symbol.iterator]() {
        log.push("get Symbol.iterator");
        return () => ({
          get next() {
            log.push("get next");
            return () => {
              const now = count++;
              log.push(`next ${now}`);
              return {
                get done() {
                  log.push(`done ${now}`);
                  return now >= 2;
                },
                get value() {
                  log.push(`value ${now}`);
                  return now;
                },
              };
            };
          },
        });
      },
    }),
    log,
  );
}
{
  const big = all(hide(upTo(100000)));
  say("many", big.length, big[99999], all(new Range(0, 70000)).length);
  const texts = all(hide((function* () { for (let i = 0; i < 50000; i++) yield `item ${i}`; })())) as string[];
  say("many strings", texts.length, texts[49999]);
  let total = 0;
  for (let round = 0; round < 40000; round++) total += all(hide(upTo(3))).length + all(new Range(0, 2)).length;
  say("many short ones", total);
  function* nested(depth: number): Generator<number, void, unknown> {
    yield depth;
    if (depth) for (const value of [...nested(depth - 1)]) yield value;
  }
  say("spreads inside generators", all(nested(6)));
}
console.log(lines.join("\n"));
