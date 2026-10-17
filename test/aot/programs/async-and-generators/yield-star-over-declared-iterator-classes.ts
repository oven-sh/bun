// yield* over objects whose Symbol.iterator is declared to return a class with next(), and { value, done } literals that are only read
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
}
function* program(effects: Effect[]): Generator<Effect, number, number> {
  let sum = 0;
  for (const effect of effects) sum += yield* effect;
  return sum;
}
function run(iterator: Generator<Effect, number, number>, log?: unknown[]): number {
  let step = iterator.next(0);
  while (!step.done) {
    log?.push(step.value.value);
    step = iterator.next(step.value.value * 2);
  }
  return step.value;
}
{
  const log: unknown[] = [];
  say("as declared", run(program([new Effect(1), new Effect(2), new Effect(3)]), log), log);
  say("none", run(program([])));
}

class Twice extends OneShot {
  count = 0;
  override next(sent?: number): IteratorResult<Effect, number> {
    if (this.count++ < 2) return { value: this.self, done: false };
    return { value: (sent ?? 0) + 1000, done: true };
  }
}
class YieldsTwice extends Effect {
  override [Symbol.iterator](): OneShot {
    return new Twice(this);
  }
}
{
  const log: unknown[] = [];
  say("a subclass of the iterator class", run(program([new YieldsTwice(5), new Effect(1)]), log), log);
}
class LooksAlike extends Effect {
  override [Symbol.iterator](): OneShot {
    let calls = 0;
    const self = this;
    return {
      next(sent?: number) {
        return calls++ ? { value: (sent ?? 0) + 7, done: true } : { value: self, done: false };
      },
    } as unknown as OneShot;
  }
}
say("an object that only looks like the class", run(program([new LooksAlike(4), new Effect(1)])));
class GivesGenerator extends Effect {
  override [Symbol.iterator](): OneShot {
    const self = this;
    return (function* (): Generator<Effect, number, number> {
      const first = yield self;
      const second = yield self;
      return first + second;
    })() as unknown as OneShot;
  }
}
say("a generator in its place", run(program([new GivesGenerator(3), new Effect(1)])));

{
  const log: string[] = [];
  class Watched extends OneShot {
    override next(sent?: number): IteratorResult<Effect, number> {
      log.push(`next(${sent})`);
      return super.next(sent);
    }
    return(value: number): IteratorResult<Effect, number> {
      log.push(`return(${value})`);
      return { value: value + 1, done: true };
    }
    throw(error: unknown): IteratorResult<Effect, number> {
      log.push(`throw(${error})`);
      return { value: 50, done: true };
    }
  }
  class GivesWatched extends Effect {
    override [Symbol.iterator](): OneShot {
      log.push("Symbol.iterator");
      return new Watched(this);
    }
  }
  const returned = program([new GivesWatched(1), new GivesWatched(2)]);
  say("return() goes to the iterator", returned.next(0).done, returned.return(9), returned.next(0), log);
  log.length = 0;
  const thrown = program([new GivesWatched(1), new GivesWatched(2)]);
  say("throw() goes to the iterator", thrown.next(0).done, thrown.throw("t").done, thrown.next(4), log);
  log.length = 0;
  const plain = program([new Effect(1)]);
  plain.next(0);
  attempt("throw() where the class has none", () => plain.throw(new Mine("no throw method")));
  const alsoPlain = program([new Effect(1)]);
  alsoPlain.next(0);
  say("return() where the class has none", alsoPlain.return(3), alsoPlain.next(0));
}
{
  class Throws extends OneShot {
    override next(): IteratorResult<Effect, number> {
      throw new Mine("next threw");
    }
  }
  class GivesThrows extends Effect {
    override [Symbol.iterator](): OneShot {
      return new Throws(this);
    }
  }
  const iterator = program([new GivesThrows(1)]);
  attempt("next() throws", () => iterator.next(0));
  say("then", iterator.next(0));
}
{
  const original = OneShot.prototype.next;
  const iterator = program([new Effect(1), new Effect(2)]);
  const first = iterator.next(0);
  OneShot.prototype.next = function (this: OneShot, sent?: number) {
    return { value: (sent ?? 0) + 100000, done: true };
  };
  const rest = [iterator.next(5), iterator.next(6)];
  OneShot.prototype.next = original;
  say("next replaced on the prototype between delegations", first.done, rest);
}

{
  const own = new Effect(1);
  Object.defineProperty(own, Symbol.iterator, {
    value() {
      return new OneShot(new Effect(42));
    },
  });
  const log: unknown[] = [];
  say("an effect with its own Symbol.iterator", run(program([own, new Effect(2)]), log), log);
  const odd: any[] = [5, null];
  class GivesNumber extends Effect {
    override [Symbol.iterator](): OneShot {
      return odd[0];
    }
  }
  attempt("Symbol.iterator returns a number", () => run(program([new GivesNumber(1)])));
  class GivesNull extends Effect {
    override [Symbol.iterator](): OneShot {
      return odd[1];
    }
  }
  attempt("Symbol.iterator returns null", () => run(program([new GivesNull(1)])));
  class ThrowsAtOpening extends Effect {
    override [Symbol.iterator](): OneShot {
      throw new Mine("while opening");
    }
  }
  const iterator = program([new ThrowsAtOpening(1)]);
  attempt("Symbol.iterator throws", () => iterator.next(0));
  say("then", iterator.next(0));
  const hidden = new Effect(3);
  Object.defineProperty(hidden, Symbol.iterator, { value: undefined });
  attempt("its own Symbol.iterator is undefined", () => run(program([hidden])));
}

function onlyRead(x: number): number {
  const result = { value: x * 2, done: x > 3 };
  return result.done ? result.value : -result.value;
}
function merged(x: number): number {
  const result = x & 1 ? { value: x, done: true } : { value: x + 100, done: false };
  return result.done ? result.value : result.value + 1;
}
function kept(x: number): { value: number; done: boolean } {
  const result = { value: x, done: false };
  if (result.done) return { value: -1, done: true };
  return result;
}
function compared(x: number): boolean {
  const a = { value: x, done: true };
  const b = { value: x, done: true };
  return (a as unknown) === b || a.value !== b.value;
}
function written(x: number): number {
  const result = { value: x, done: false };
  result.value += 5;
  result.done = true;
  return result.done ? result.value : 0;
}
function otherOrder(x: number): string {
  const result = { done: x > 0, value: x };
  return Object.keys(result).join() + result.value + result.done;
}
function third(x: number): number {
  const result = { value: x, done: true, extra: 1 };
  return result.value + result.extra + (result.done ? 1 : 0);
}
function nested(x: number): number {
  const inner = { value: x, done: true };
  const outer = { value: inner, done: false };
  return outer.done ? 0 : outer.value.value;
}
function notBoolean(x: number): unknown {
  const result = { value: x, done: x as unknown };
  return [result.done, result.value];
}
function missing(x: number): unknown {
  const result: { value: number; done: boolean; other?: number } = { value: x, done: true };
  return [result.other, "toString" in result, result.value];
}
function inLoop(n: number): number {
  let result = { value: 0, done: false };
  while (!result.done) result = { value: result.value + 3, done: result.value > n };
  return result.value;
}
say("literals", onlyRead(2), onlyRead(5), merged(1), merged(2), kept(3), compared(1), written(1), otherOrder(2), third(3), nested(4), notBoolean(5), missing(6), inLoop(20));

{
  let total = 0;
  const effects: Effect[] = [];
  for (let i = 0; i < 500; i++) effects.push(new Effect(i));
  for (let round = 0; round < 40; round++) total += run(program(effects));
  say("many", total);
}

console.log(lines.join("\n"));
