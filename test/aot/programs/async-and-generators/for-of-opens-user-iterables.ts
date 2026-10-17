// how for..of and destructuring get an iterator out of an object that a user wrote: every kind of Symbol.iterator and every kind of iterator
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
function collect(values: Iterable<unknown>, limit = 6): unknown[] {
  const seen: unknown[] = [];
  for (const value of values) {
    seen.push(value);
    if (seen.length >= limit) break;
  }
  return seen;
}
function firstTwo(values: Iterable<unknown>): unknown[] {
  const [a, b] = values;
  return [a, b];
}
function counting(to: number) {
  let at = 0;
  return { next: () => (at < to ? { value: at++, done: false } : { value: undefined, done: true }) };
}
const as = (value: unknown) => value as Iterable<unknown>;

class OnPrototype {
  [Symbol.iterator]() {
    return counting(3);
  }
}
class Inherits extends OnPrototype {}
class WithGeneratorMethod {
  constructor(readonly to: number) {}
  *[Symbol.iterator](): Generator<number, void, unknown> {
    for (let i = 0; i < this.to; i++) yield i;
  }
}
class ReturnsItself {
  at = 0;
  [Symbol.iterator]() {
    return this;
  }
  next() {
    return this.at < 2 ? { value: this.at++, done: false } : { value: undefined, done: true };
  }
}
say("a method of the class", collect(new OnPrototype()), firstTwo(new OnPrototype()));
say("inherited", collect(new Inherits()));
say("a generator method", collect(new WithGeneratorMethod(4)), firstTwo(new WithGeneratorMethod(1)), collect(new WithGeneratorMethod(0)));
say("the iterable is its own iterator", collect(new ReturnsItself()));
say("an own property", collect({ [Symbol.iterator]: () => counting(2) }));
say("an object without a prototype", collect(as(Object.assign(Object.create(null), { [Symbol.iterator]: () => counting(2) }))));
say("inherited from an object", collect(as(Object.create({ [Symbol.iterator]: () => counting(2) }))));
{
  const log: string[] = [];
  const iterable = {
    get [Symbol.iterator]() {
      log.push("get Symbol.iterator");
      return function (this: unknown) {
        log.push(this === iterable ? "called on the iterable" : "called on something else");
        return {
          get next() {
            log.push("get next");
            return () => {
              log.push("call next");
              return { value: 1, done: log.length > 6 };
            };
          },
          get return() {
            log.push("get return");
            return undefined;
          },
        };
      };
    },
  };
  say("the order of what is observable", collect(iterable), log);
  log.length = 0;
  say("and when it is left early", collect(iterable, 1), log);
}
say("it returns an array's iterator", collect({ [Symbol.iterator]: () => ["a", "b"][Symbol.iterator]() }));
say("it returns a Map's iterator", collect({ [Symbol.iterator]: () => new Map([["k", 1]]).entries() }));
say("it returns a Set's iterator", collect({ [Symbol.iterator]: () => new Set(["s"]).values() }));
say("it returns a string's iterator", collect({ [Symbol.iterator]: () => "xy"[Symbol.iterator]() }));
say("it returns matches", collect({ [Symbol.iterator]: () => "a1b2".matchAll(/\d/g) }).length);
{
  function* numbers(): Generator<number, void, unknown> {
    yield 1;
    yield 2;
  }
  say("it returns a generator", collect({ [Symbol.iterator]: numbers }));
  const changed = numbers();
  (changed as any).next = () => ({ value: "its own next", done: false });
  say("it returns a changed generator", collect({ [Symbol.iterator]: () => changed }, 2));
  const started = numbers();
  started.next();
  say("it returns one that has started", collect({ [Symbol.iterator]: () => started }));
  const other = numbers();
  (other as any)[Symbol.iterator] = () => counting(1);
  say("a generator with its own Symbol.iterator", collect(other));
}
say("Array.prototype.values on an array-like", collect(as({ length: 2, 0: "a", 1: "b", [Symbol.iterator]: Array.prototype.values })));
say("a bound function", collect(as({ [Symbol.iterator]: counting.bind(null, 2) })));
say("a proxy of a function", collect(as({ [Symbol.iterator]: new Proxy(() => counting(2), {}) })));
say("a proxy of an iterable", collect(as(new Proxy(new OnPrototype(), {}))));
say("it returns a proxy", collect(as({ [Symbol.iterator]: () => new Proxy(counting(2), {}) })));
say("it returns a function with next", collect(as({ [Symbol.iterator]: () => Object.assign(() => 0, counting(2)) })));
say("it returns an array with next", collect(as({ [Symbol.iterator]: () => Object.assign([], counting(2)) })));
say(
  "arguments it gets",
  collect(
    as({
      [Symbol.iterator](first: unknown) {
        return counting(arguments.length === 0 && first === undefined ? 1 : 5);
      },
    }),
  ),
);
for (const [title, value] of [
  ["undefined", undefined],
  ["null", null],
  ["a plain object", {}],
  ["an object without a prototype", Object.create(null)],
  ["a function", () => 0],
  ["an instance of a class", new Mine("x")],
  ["Symbol.iterator is undefined", { [Symbol.iterator]: undefined }],
  ["Symbol.iterator is null", { [Symbol.iterator]: null }],
  ["Symbol.iterator is a number", { [Symbol.iterator]: 1 }],
  ["Symbol.iterator is an object", { [Symbol.iterator]: {} }],
  ["Symbol.iterator is a class", { [Symbol.iterator]: class {} }],
  ["it returns undefined", { [Symbol.iterator]: () => undefined }],
  ["it returns null", { [Symbol.iterator]: () => null }],
  ["it returns a number", { [Symbol.iterator]: () => 1 }],
  ["it returns a string", { [Symbol.iterator]: () => "s" }],
  ["it returns an object without next", { [Symbol.iterator]: () => ({}) }],
  ["it throws", { [Symbol.iterator]: () => { throw new Mine("while opening"); } }],
  ["the getter throws", { get [Symbol.iterator]() { throw new Mine("while reading Symbol.iterator"); } }],
  ["the getter of next throws", { [Symbol.iterator]: () => ({ get next() { throw new Mine("while reading next"); } }) }],
] as [string, unknown][]) {
  attempt(`for..of: ${title}`, () => collect(as(value)));
  attempt(`pattern: ${title}`, () => firstTwo(as(value)));
}
{
  const iterable: any = { [Symbol.iterator]: () => counting(1) };
  const seen = [collect(iterable)];
  iterable[Symbol.iterator] = () => counting(2);
  seen.push(collect(iterable));
  iterable.other = 1;
  seen.push(collect(iterable));
  delete iterable[Symbol.iterator];
  attempt("after it was deleted", () => collect(iterable));
  Object.setPrototypeOf(iterable, { [Symbol.iterator]: () => counting(3) });
  seen.push(collect(iterable));
  Object.getPrototypeOf(iterable)[Symbol.iterator] = () => counting(4);
  seen.push(collect(iterable));
  say("the method changes between loops", seen);
  class Patched {
    [Symbol.iterator]() {
      return counting(1);
    }
  }
  const instance = new Patched();
  const before = collect(instance);
  let patched: unknown;
  try {
    (Patched.prototype as any)[Symbol.iterator] = () => counting(2);
    patched = "patched";
  } catch (error) {
    patched = "the prototype is locked";
  }
  say("a class is patched", before, typeof patched, collect(instance).length >= 1);
}
{
  function stackNames(stack: string | undefined): string {
    const names: string[] = [];
    for (const line of (stack ?? "").split("\n")) {
      if (line.endsWith("@[native code]")) continue;
      const found = /^\s*at (?:async )?(?:([^\s(]+) \()?/.exec(line) ?? /^([^@]*)@/.exec(line);
      if (!found) continue;
      const name = found[1] ?? "";
      if (name === "" || name === "module code" || name === "global code") break;
      names.push(name);
    }
    return names.join(" < ");
  }
  function opens(values: Iterable<unknown>): unknown {
    for (const value of values) return value;
  }
  say(
    "the stack in Symbol.iterator",
    opens({
      [Symbol.iterator]: function opener() {
        const names = stackNames(new Error("x").stack);
        return { next: () => ({ value: names, done: false }) };
      },
    }),
  );
  say(
    "the stack in next",
    opens({
      [Symbol.iterator]: () => ({
        next: function stepper() {
          return { value: stackNames(new Error("x").stack), done: false };
        },
      }),
    }),
  );
}
{
  function deep(n: number): number {
    let sum = 0;
    for (const value of {
      [Symbol.iterator]() {
        return counting(n ? deep(n - 1) + 1 : 1);
      },
    })
      sum += 1 + (value as number) * 0;
    return sum;
  }
  say("Symbol.iterator methods that loop themselves", deep(10));
  function endless(): number {
    for (const value of { [Symbol.iterator]: () => counting(endless()) }) return value as number;
    return 0;
  }
  attempt("without end", () => {
    try {
      return endless();
    } catch (error) {
      return error instanceof RangeError ? "RangeError" : String(error);
    }
  });
  let total = 0;
  for (let round = 0; round < 60000; round++) for (const value of new WithGeneratorMethod(2)) total += value;
  for (let round = 0; round < 60000; round++) for (const value of new OnPrototype()) total += value as number;
  say("many short loops", total);
  let shapes = 0;
  for (let round = 0; round < 400; round++) {
    const own: any = { ["field" + round]: round, [Symbol.iterator]: () => counting(1) };
    const inherits: any = Object.create({ ["other" + round]: round, [Symbol.iterator]: () => counting(2) });
    const reads: any = { ["third" + round]: round, get [Symbol.iterator]() { return () => counting(3); } };
    shapes += collect(own).length + collect(inherits).length + collect(reads).length + [...own, ...inherits, ...reads].length;
  }
  say("as many shapes as loops", shapes);
}
console.log(lines.join("\n"));
