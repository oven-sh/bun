// `super(executor)` in a class that extends Promise: what a program can see of it stays as the language says.
const log: string[] = [];
const say = (...parts: unknown[]) => log.push(parts.map(String).join(" "));

class Plain<T> extends Promise<T> {}

class WithField<T> extends Promise<T> {
  label = "field";
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void, readonly tag: string) {
    super(executor);
  }
}

class Keeps<T> extends Promise<T> {
  static get [Symbol.species]() {
    return Promise;
  }
  resolveLater!: (value: T) => void;
  rejectLater!: (reason: unknown) => void;
  constructor() {
    let resolveFunction: (value: T) => void, rejectFunction: (reason: unknown) => void;
    super((resolve, reject) => {
      resolveFunction = resolve;
      rejectFunction = reject;
    });
    this.resolveLater = resolveFunction!;
    this.rejectLater = rejectFunction!;
  }
}

class Lazy<T> extends Promise<T> {
  static get [Symbol.species]() {
    return Promise;
  }
  started = 0;
  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    this.started++;
    return super.then(onFulfilled, onRejected);
  }
}

class Deeper<T> extends WithField<T> {
  constructor(executor: (resolve: (value: T) => void) => void) {
    super(executor, "deeper");
  }
}

const Alias = Promise;
class ThroughAlias<T> extends Alias<T> {
  constructor(executor: (resolve: (value: T) => void) => void) {
    super(executor);
  }
}

async function basics(): Promise<void> {
  const plain = new Plain<number>(resolve => resolve(1));
  say("plain", plain instanceof Plain, plain instanceof Promise, Object.getPrototypeOf(plain) === Plain.prototype, await plain);
  const field = new WithField<string>(resolve => resolve("value"), "tag");
  say("field", field.label, field.tag, Object.keys(field).join(), await field);
  const deeper = new Deeper<number>(resolve => resolve(3));
  say("deeper", deeper.tag, deeper instanceof WithField, Object.getPrototypeOf(deeper) === Deeper.prototype, await deeper);
  const alias = new ThroughAlias<number>(resolve => resolve(4));
  say("alias", alias instanceof ThroughAlias, await alias);
  const derived = plain.then(value => value + 1);
  say("derived", derived instanceof Plain, derived.constructor === Plain, await derived);
  const lazy = new Lazy<number>(resolve => resolve(5));
  const fromLazy = lazy.then(value => value * 2);
  say("lazy", lazy.started, fromLazy instanceof Lazy, fromLazy.constructor === Promise, await fromLazy, await lazy, lazy.started);
}

async function resolvingFunctions(): Promise<void> {
  const keeps = new Keeps<number>();
  say("functions", typeof keeps.resolveLater, keeps.resolveLater.length, keeps.rejectLater.length, JSON.stringify(keeps.resolveLater.name), Object.getPrototypeOf(keeps.resolveLater) === Function.prototype);
  say("result of resolve", keeps.resolveLater(1));
  keeps.resolveLater(2);
  keeps.rejectLater(new Error("late"));
  say("first wins", await keeps);
  const rejected = new Keeps<number>();
  rejected.rejectLater("reason");
  rejected.resolveLater(1);
  say("rejected", await rejected.catch(reason => "caught " + reason));
  const self = new Keeps<unknown>();
  self.resolveLater(self);
  say("self", await self.catch(error => (error as Error).constructor.name));
  const chained = new Keeps<unknown>();
  chained.resolveLater(new Plain<string>(resolve => resolve("inner")));
  say("chained", await chained);
  const thenable = new Keeps<unknown>();
  thenable.resolveLater({ then(resolve: (value: string) => void) { say("then called"); resolve("from thenable"); } });
  say("before");
  say("thenable", await thenable);
}

async function failures(): Promise<void> {
  const thrown = new Plain<number>(() => {
    throw new RangeError("in the executor");
  });
  say("thrown", await thrown.catch(error => (error as Error).message));
  const afterResolve = new Plain<number>(resolve => {
    resolve(7);
    throw new Error("ignored");
  });
  say("after resolve", await afterResolve);
  for (const executor of [undefined, null, 1, "text", {}, Symbol.iterator]) {
    try {
      new Plain<number>(executor as any);
      say("no error");
    } catch (error) {
      say("not callable", (error as Error).constructor.name, (error as Error).message);
    }
  }
  try {
    Reflect.construct(Plain, []);
  } catch (error) {
    say("no arguments", (error as Error).constructor.name);
  }
  say("more arguments", await Reflect.construct(Plain, [(resolve: (value: number) => void) => resolve(8), 1, 2]));
  try {
    (Plain as unknown as (executor: unknown) => unknown)(() => {});
  } catch (error) {
    say("called", (error as Error).constructor.name);
  }
}

async function newTargets(): Promise<void> {
  function Other() {}
  Other.prototype = { marker: "other" };
  const constructed = Reflect.construct(Plain, [(resolve: (value: number) => void) => resolve(1)], Other) as Promise<number> & { marker?: string };
  say("new.target", constructed.marker, constructed instanceof Plain, Object.getPrototypeOf(constructed) === Other.prototype);
  say("still a promise", await Promise.prototype.then.call(constructed, value => value));
  const order: string[] = [];
  const watched = new Proxy(function () {}, {
    get(target, key, receiver) {
      order.push("get " + String(key));
      return key === "prototype" ? Plain.prototype : Reflect.get(target, key, receiver);
    },
  });
  Reflect.construct(Plain, [() => order.push("executor")], watched);
  say("order", order.join());
  const orderWithBadExecutor: string[] = [];
  const watchedAgain = new Proxy(function () {}, {
    get(target, key, receiver) {
      orderWithBadExecutor.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
  });
  try {
    Reflect.construct(Plain, [1], watchedAgain);
  } catch (error) {
    say("bad executor first", (error as Error).constructor.name, orderWithBadExecutor.join());
  }
  try {
    Reflect.construct(Plain, [() => say("the executor ran")], new Proxy(function () {}, {
      get(target, key, receiver) {
        if (key === "prototype") throw new ReferenceError("from the proxy");
        return Reflect.get(target, key, receiver);
      },
    }));
  } catch (error) {
    say("new.target throws", (error as Error).constructor.name, (error as Error).message);
  }
  function Primitive() {}
  Primitive.prototype = 1 as any;
  const fallsBack = Reflect.construct(Plain, [() => {}], Primitive);
  say("primitive prototype", Object.getPrototypeOf(fallsBack) === Promise.prototype);
}

async function order(): Promise<void> {
  const steps: string[] = [];
  const first = new Lazy<string>(resolve => {
    steps.push("executor");
    resolve("value");
  });
  steps.push("constructed");
  Promise.resolve().then(() => steps.push("job 1")).then(() => steps.push("job 2")).then(() => steps.push("job 3")).then(() => steps.push("job 4"));
  first.then(() => steps.push("reaction"));
  (async () => {
    await first;
    steps.push("awaited");
  })();
  for (let turn = 0; turn < 12; turn++) await undefined;
  say(steps.join());
}

function framesOf(error: Error): string {
  const names = String(error.stack).split("\n").map(line => line.replace(/@.*|\s*\(.*|^\s*at\s+/g, "").trim().replace(/^new /, ""));
  return names.filter(name => /^[A-Za-z]+$/.test(name) && name !== "construct").slice(0, 3).join(" < ");
}

function stackTraces(): void {
  let seen: Error | undefined;
  function looksFromExecutor(): void {
    new WithField<number>(() => {
      seen = new Error("look");
    }, "t");
  }
  for (let turn = 0; turn < 40; turn++) looksFromExecutor();
  say("from an executor:", framesOf(seen!));
  function looksThroughImplicitConstructor(): void {
    new Plain<number>(() => {
      seen = new Error("look");
    });
  }
  for (let turn = 0; turn < 40; turn++) looksThroughImplicitConstructor();
  say("through an implicit constructor:", framesOf(seen!));
}

async function many(): Promise<void> {
  let total = 0;
  for (let i = 0; i < 2000; i++) total += await new WithField<number>(resolve => resolve(i), "t");
  say("many", total);
}

await basics();
await resolvingFunctions();
await failures();
await newTargets();
await order();
stackTraces();
await many();
console.log(log.join("\n"));
