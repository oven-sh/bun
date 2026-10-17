// for..of and destructuring over iterables that users write: every kind of next() and every kind of result object
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
function collect(values: Iterable<unknown>, limit = 10): unknown[] {
  const seen: unknown[] = [];
  for (const value of values) {
    seen.push(value);
    if (seen.length >= limit) break;
  }
  return seen;
}
function collectAny(values: any): unknown[] {
  const seen: unknown[] = [];
  for (const value of values) seen.push(value);
  return seen;
}
function from(next: (this: unknown) => unknown, more: object = {}): Iterable<unknown> {
  return {
    [Symbol.iterator]() {
      return { next, ...more };
    },
  } as Iterable<unknown>;
}

class RangeIterator {
  at: number;
  constructor(
    at: number,
    readonly end: number,
  ) {
    this.at = at;
  }
  next(): IteratorResult<number, undefined> {
    if (this.at < this.end) return { value: this.at++, done: false };
    return { value: undefined, done: true };
  }
}
class Range {
  constructor(
    readonly from: number,
    readonly to: number,
  ) {}
  [Symbol.iterator](): RangeIterator {
    return new RangeIterator(this.from, this.to);
  }
}
say("a class", collect(new Range(0, 4)), collectAny(new Range(2, 5)), collect(new Range(3, 3)));
{
  let at = 0;
  say("closures", collect(from(() => (at < 3 ? { value: at++, done: false } : { value: undefined, done: true }))));
}
{
  const [a, b, c] = new Range(5, 7);
  const [first, ...rest] = new Range(1, 5);
  say("patterns", a, b, c === undefined, first, rest);
}

for (const [title, done] of [
  ["0", 0],
  ["an empty string", ""],
  ["null", null],
  ["undefined", undefined],
  ["NaN", NaN],
  ["1", 1],
  ["a string", "x"],
  ["an object", {}],
  ["0n", 0n],
] as [string, unknown][]) {
  let count = 0;
  say("done is", title, collect(from(() => (count++ < 2 ? { value: count, done } : { value: -1, done: true }))).length);
}
{
  let count = 0;
  say("no done at all", collect(from(() => (count++ < 2 ? { value: count } : { done: true }))));
  count = 0;
  say("no value at all", collect(from(() => (count++ < 2 ? { done: false } : { done: true }))));
  count = 0;
  say("other order of the properties", collect(from(() => (count++ < 2 ? { done: false, value: count } : { done: true, value: 0 }))));
  count = 0;
  say("more properties", collect(from(() => (count++ < 3 ? { extra: "e", value: count, other: 1, done: false } : { value: 0, done: true }))));
  count = 0;
  say(
    "the shape changes from step to step",
    collect(
      from(() => {
        count++;
        if (count === 1) return { value: "a", done: false };
        if (count === 2) return { done: false, value: "b" };
        if (count === 3) return { x: 1, value: "c", done: false };
        if (count === 4) return { value: "d", done: false };
        return { done: true };
      }),
    ),
  );
}
{
  const log: string[] = [];
  let count = 0;
  const values = collect(
    from(() => {
      const now = count++;
      log.push(`next ${now}`);
      return {
        get done() {
          log.push(`get done ${now}`);
          return now >= 2;
        },
        get value() {
          log.push(`get value ${now}`);
          return now;
        },
      };
    }),
  );
  say("getters", values, log);
}
{
  let count = 0;
  const inherited = { value: "inherited", done: false };
  say("inherited done and value", collect(from(() => (count++ < 2 ? Object.create(inherited) : { done: true }))));
  count = 0;
  say("value inherited, done its own", collect(from(() => (count++ < 2 ? Object.assign(Object.create({ value: "above" }), { done: false }) : { done: true }))));
  count = 0;
  class Result {
    constructor(
      readonly value: number,
      readonly done: boolean,
    ) {}
  }
  say("instances of a class", collect(from(() => new Result(count, count++ >= 3))));
  count = 0;
  say("frozen results", collect(from(() => Object.freeze({ value: count, done: count++ >= 2 }))));
  count = 0;
  say("proxies", collect(from(() => new Proxy({ value: count, done: count++ >= 2 }, {}))));
  count = 0;
  say("arrays with properties", collect(from(() => Object.assign([], { value: count, done: count++ >= 2 }))));
  count = 0;
  say("functions with properties", collect(from(() => Object.assign(() => 0, { value: count, done: count++ >= 2 }))));
  count = 0;
  say(
    "a property was deleted and added again",
    collect(
      from(() => {
        const result: any = { value: -1, done: true, extra: 0 };
        delete result.value;
        delete result.done;
        result.done = count >= 2;
        result.value = count++;
        return result;
      }),
    ),
  );
  count = 0;
  const same = { value: 0, done: false };
  say(
    "one object used again and again",
    collect(
      from(() => {
        same.value = count;
        same.done = count++ >= 3;
        return same;
      }),
    ),
  );
}
for (const [title, result] of [
  ["undefined", undefined],
  ["null", null],
  ["a number", 1],
  ["a string", "s"],
  ["true", true],
  ["a symbol", Symbol.iterator],
] as [string, unknown][])
  attempt(`next returns ${title}`, () => collect(from(() => result)));
attempt("next throws", () =>
  collect(
    from(() => {
      throw new Mine("from next");
    }),
  ),
);
for (const [title, next] of [
  ["undefined", undefined],
  ["a number", 5],
  ["17", 17],
  ["a double", 1.5],
  ["an object", {}],
  ["a class", class {}],
] as [string, unknown][])
  attempt(`next is ${title}`, () => collect(from(next as any)));
{
  let count = 0;
  const step = function (this: { base: number }) {
    return { value: this.base + count, done: count++ >= 2 };
  };
  say("a bound function", collect(from(step.bind({ base: 100 }))));
  const inner = [7, 8][Symbol.iterator]();
  say("a native function, bound", collect(from(inner.next.bind(inner))));
  count = 0;
  say("a proxy of a function", collect(from(new Proxy(() => ({ value: count, done: count++ >= 2 }), {}))));
  count = 0;
  say("this is the iterator", collect(from(function (this: any) {
    return { value: typeof this.next, done: count++ >= 1 };
  })));
  count = 0;
  say("more parameters than arguments", collect(from(function (a?: unknown, b?: unknown) {
    return { value: [a === undefined, b === undefined, arguments.length], done: count++ >= 1 };
  } as any)));
}
{
  let count = 0;
  const iterator: any = {
    next() {
      if (count === 1) iterator.next = () => ({ value: "never seen: next is read once", done: false });
      return { value: count, done: count++ >= 3 };
    },
  };
  say("next is replaced meanwhile", collect({ [Symbol.iterator]: () => iterator }));
}
{
  const log: string[] = [];
  let count = 0;
  const closing = () =>
    from(() => ({ value: count++, done: false }), {
      return() {
        log.push("return");
        return {};
      },
    });
  say("left early", collect(closing(), 2), log);
  attempt("the body throws", () => {
    for (const value of closing()) if ((value as number) > 3) throw new Mine("from the body");
  });
  say("log", log);
  attempt("return gives a number", () => collect(from(() => ({ value: 1, done: false }), { return: () => 1 }), 1));
  attempt("return throws", () =>
    collect(
      from(() => ({ value: 1, done: false }), {
        return() {
          throw new Mine("from return");
        },
      }),
      1,
    ),
  );
}
{
  function* inner(): Generator<number, void, unknown> {
    for (const value of new Range(0, 3)) yield value * 2;
  }
  say("inside a generator", [...inner()]);
  const nested: number[] = [];
  for (const a of new Range(0, 3)) for (const b of new Range(0, a)) nested.push(a * 10 + b);
  say("nested", nested);
  function deep(n: number): number {
    let sum = n;
    for (const value of from(() => ({ value: n ? deep(n - 1) : 0, done: sum !== n }))) sum += (value as number) + 1;
    return sum;
  }
  say("a next that loops itself", deep(12));
}
{
  let sum = 0;
  for (let round = 0; round < 30; round++) for (const value of new Range(0, 5000) as Iterable<number>) sum += value;
  let length = 0;
  let count = 0;
  for (const text of from(() => ({ value: `item ${count}`, done: count++ >= 100000 }))) length += (text as string).length;
  say("many", sum, length);
}
{
  const makers: (() => Iterable<unknown>)[] = [];
  for (let kind = 0; kind < 6; kind++) {
    makers.push(() => {
      let count = 0;
      return from(() => {
        const now = count++;
        if (kind === 0) return { value: now, done: now >= 2 };
        if (kind === 1) return { done: now >= 2, value: now };
        if (kind === 2) return { a: 0, value: now, done: now >= 2 };
        if (kind === 3) return { a: 0, b: 0, done: now >= 2, value: now };
        if (kind === 4) return now >= 2 ? { done: true } : { value: now, done: false, last: 0 };
        return Object.assign(Object.create(null), { value: now, done: now >= 2 });
      });
    });
  }
  let sum = 0;
  for (let round = 0; round < 3000; round++) for (const value of makers[(round * 7) % 6]()) sum += (value as number) + 1;
  const held: unknown[] = [];
  for (let round = 0; round < 40; round++) {
    for (let i = 0; i < 2000; i++) held[i % 50] = { ["shape" + ((round * 2000 + i) % 977)]: i };
    for (const value of makers[round % 6]()) sum += (value as number) + 1;
  }
  say("six shapes of results in turn, and many other shapes made and dropped between", sum);
}
console.log(lines.join("\n"));
