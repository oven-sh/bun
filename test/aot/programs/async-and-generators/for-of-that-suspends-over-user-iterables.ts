// for..of with a yield or an await in its body, over iterables that users write: the loop's state outlives the frame
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}
class Mine extends Error {}
function counting(to: number, log?: string[]) {
  let at = 0;
  return {
    next: () => (at < to ? { value: at++, done: false } : { value: undefined, done: true }),
    return() {
      log?.push("return");
      return { value: undefined, done: true };
    },
  };
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
class Walk {
  constructor(readonly to: number) {}
  *[Symbol.iterator](): Generator<number, void, unknown> {
    for (let i = 0; i < this.to; i++) yield i;
  }
}
function* each(values: Iterable<unknown>): Generator<unknown, string, unknown> {
  for (const value of values) yield value;
  return "over";
}
async function gather(values: Iterable<unknown>, limit = 100): Promise<unknown[]> {
  const seen: unknown[] = [];
  for (const value of values) {
    seen.push(await value);
    if (seen.length >= limit) break;
  }
  return seen;
}
async function* eachLater(values: Iterable<unknown>): AsyncGenerator<unknown, void, unknown> {
  for (const value of values) yield value;
}
function from(next: () => unknown, more: object = {}): Iterable<unknown> {
  return { [Symbol.iterator]: () => ({ next, ...more }) } as Iterable<unknown>;
}
async function attempt(title: string, run: () => unknown) {
  try {
    say(title, "->", await run());
  } catch (error) {
    say(title, "threw", error instanceof Mine ? error.message : error instanceof Error ? error.constructor.name : error);
  }
}

say("in a generator", [...each(new Range(0, 4))], [...each(new Walk(3))], [...each({ [Symbol.iterator]: () => counting(2) })], [...each(new Range(1, 1))]);
{
  const log: string[] = [];
  const outer = each({ [Symbol.iterator]: () => counting(5, log) });
  say("return() of the outer one closes the iterator", outer.next(), outer.return("asked"), log, outer.next());
  log.length = 0;
  const thrown = each({ [Symbol.iterator]: () => counting(5, log) });
  thrown.next();
  try {
    thrown.throw(new Mine("thrown in"));
  } catch (error) {
    say("throw() into the outer one closes it too", (error as Error).message, log);
  }
}
{
  let count = 0;
  say(
    "the shape of the results changes while the loop is suspended",
    [
      ...each(
        from(() => {
          count++;
          if (count === 1) return { value: "a", done: false };
          if (count === 2) return { done: false, value: "b" };
          if (count === 3) return { extra: 1, value: "c", done: false };
          if (count === 4) return Object.create({ value: "inherited", done: false });
          if (count === 5) return { value: "e", done: 0 };
          return { done: "truthy" };
        }),
      ),
    ],
  );
  const log: string[] = [];
  count = 0;
  say(
    "getters",
    [
      ...each(
        from(() => {
          const now = count++;
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
        }),
      ),
    ],
    log,
  );
}
{
  const first = each(new Range(0, 3));
  const second = each(new Range(10, 13));
  say("two suspended loops in turn", first.next().value, second.next().value, first.next().value, second.next().value, first.next().value, second.next().value, first.next(), second.next());
  function* nested(): Generator<number, void, unknown> {
    for (const a of new Range(0, 3) as Iterable<number>) for (const b of new Range(0, a) as Iterable<number>) yield a * 10 + b;
  }
  say("nested", [...nested()]);
}
await attempt("in an async function", () => gather(new Range(0, 4)));
await attempt("a generator method", () => gather(new Walk(3)));
await attempt("closures", () => gather({ [Symbol.iterator]: () => counting(3) }));
{
  const log: string[] = [];
  await attempt("left early", () => gather({ [Symbol.iterator]: () => counting(9, log) }, 2));
  say("log", log);
}
await attempt("promises as values", () => gather(from((() => { let n = 0; return () => ({ value: Promise.resolve(n), done: n++ >= 2 }); })())));
{
  const log: string[] = [];
  await attempt("a rejected value closes the iterator", () =>
    gather(from(() => ({ value: Promise.reject(new Mine("rejected")), done: false }), { return() { log.push("return"); return {}; } })),
  );
  say("log", log);
}
await attempt("next throws", () => gather(from(() => { throw new Mine("from next"); })));
await attempt("next returns a number", () => gather(from(() => 1)));
await attempt("next is not a function", () => gather({ [Symbol.iterator]: () => ({ next: 1 }) } as unknown as Iterable<unknown>));
await attempt("in an async generator", async () => {
  const seen: unknown[] = [];
  for await (const value of eachLater(new Range(0, 3))) seen.push(value);
  return seen;
});
await attempt("two async loops at once", async () => (await Promise.all([gather(new Range(0, 3)), gather(new Range(5, 8)), gather(new Walk(2))])).flat());
{
  let total = 0;
  for (const value of each(new Range(0, 60000))) total += value as number;
  const texts = await gather(from((() => { let n = 0; return () => ({ value: `item ${n}`, done: n++ >= 30000 }); })()), 1e9);
  say("many", total, texts.length, texts[29999]);
}
console.log(lines.join("\n"));
