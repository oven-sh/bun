// Promise.resolve fulfills a new promise with a class instance directly, and adopts every value that has, gains or inherits a `then`.
const log: string[] = [];

type Settle = (value: unknown) => void;

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class Late {
  constructor(public label: string) {}
}

class Moved {
  constructor(public label: string) {}
}

class Derived<T> extends Promise<T> {}

function describe(value: unknown): string {
  if (value instanceof Point) return `Point(${value.x}, ${value.y})`;
  if (value instanceof Late) return `Late(${value.label})`;
  if (value instanceof Moved) return `Moved(${value.label})`;
  if (value instanceof Error) return `${value.name}(${value.message})`;
  return String(value);
}

async function report(label: string, promise: Promise<unknown>): Promise<void> {
  const seen = { outcome: "" };
  promise.then(
    value => {
      seen.outcome = "fulfilled with " + describe(value);
    },
    reason => {
      seen.outcome = "rejected with " + describe(reason);
    },
  );
  let turns = 0;
  while (!seen.outcome) {
    await undefined;
    turns++;
  }
  log.push(`${label}: ${seen.outcome} after ${turns}`);
}

function resolvePoint(point: Point): Promise<unknown> {
  return Promise.resolve(point);
}

function resolveLate(late: Late): Promise<unknown> {
  return Promise.resolve(late);
}

function resolveMoved(moved: Moved): Promise<unknown> {
  return Promise.resolve(moved);
}

function resolveNumberOrPoint(value: number | Point): Promise<unknown> {
  return Promise.resolve(value);
}

function resolveStringOrPoint(value: string | Point): Promise<unknown> {
  return Promise.resolve(value);
}

function resolveAnything(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}

async function instances(): Promise<void> {
  const plain = new Point(1, 2);
  await report("instance", resolvePoint(plain));

  const thenable = new Point(3, 4);
  (thenable as any).then = function (this: Point, resolve: Settle): void {
    log.push(`then runs on ${describe(this)}`);
    resolve("adopted");
  };
  log.push("before the call");
  const adopted = resolvePoint(thenable);
  log.push("after the call");
  await report("instance with an own then", adopted);

  delete (thenable as any).then;
  await report("instance whose then is deleted", resolvePoint(thenable));

  const rejecting = new Point(5, 6);
  (rejecting as any).then = function (resolve: Settle, reject: Settle): void {
    reject("the reason");
    resolve("ignored");
  };
  await report("instance whose then rejects", resolvePoint(rejecting));

  const notCallable = new Point(7, 8);
  (notCallable as any).then = 9;
  await report("instance whose then is a number", resolvePoint(notCallable));

  const watched = new Point(10, 11);
  Object.defineProperty(watched, "then", {
    get() {
      log.push("then is read");
      return undefined;
    },
  });
  await report("instance whose then is a getter", resolvePoint(watched));

  const throwing = new Point(12, 13);
  Object.defineProperty(throwing, "then", {
    get() {
      throw new RangeError("then throws");
    },
  });
  await report("instance whose then throws", resolvePoint(throwing));

  const other = new Point(14, 15);
  (other as any).extra = "extra";
  await report("instance with another extra property", resolvePoint(other));
  await report("the first instance again", resolvePoint(plain));
}

async function prototypes(): Promise<void> {
  const late = new Late("first");
  await report("before the prototype has a then", resolveLate(late));
  (Late.prototype as any).then = function (this: Late, resolve: Settle): void {
    resolve(`then of ${this.label}`);
  };
  await report("after the prototype gained a then", resolveLate(late));
  await report("an instance created afterwards", resolveLate(new Late("second")));
  delete (Late.prototype as any).then;
  await report("after the prototype lost its then", resolveLate(late));

  const moved = new Moved("moved");
  await report("before the prototype is replaced", resolveMoved(moved));
  Object.setPrototypeOf(moved, {
    then(this: Moved, resolve: Settle): void {
      resolve(`then of ${this.label}`);
    },
  });
  await report("after the prototype is replaced", resolveMoved(moved));
  await report("an instance with the original prototype", resolveMoved(new Moved("unmoved")));
}

async function promises(): Promise<void> {
  const pristine = Promise.resolve("pristine");
  log.push(`promise: ${Promise.resolve(pristine) === pristine}`);

  const derived = new Derived<string>(resolve => resolve("derived"));
  const wrapped = Promise.resolve(derived);
  log.push(`subclass: ${wrapped === derived} ${wrapped instanceof Derived} ${wrapped.constructor === Promise}`);
  await report("subclass", wrapped);
  log.push(`resolve of the subclass: ${Derived.resolve(derived) === derived} ${Derived.resolve(pristine) === pristine} ${Derived.resolve(1) instanceof Derived}`);

  const ownConstructor = Promise.resolve("own constructor");
  (ownConstructor as any).constructor = Derived;
  const rewrapped = Promise.resolve(ownConstructor);
  log.push(`own constructor: ${rewrapped === ownConstructor} ${rewrapped instanceof Derived}`);
  await report("own constructor", rewrapped);

  const sameConstructor = Promise.resolve("same constructor");
  (sameConstructor as any).constructor = Promise;
  log.push(`own constructor that is Promise: ${Promise.resolve(sameConstructor) === sameConstructor}`);

  const watched = Promise.resolve("watched");
  Object.defineProperty(watched, "constructor", {
    get() {
      log.push("constructor is read");
      return Promise;
    },
  });
  log.push(`constructor getter: ${Promise.resolve(watched) === watched}`);

  const throwing = Promise.resolve("throwing");
  Object.defineProperty(throwing, "constructor", {
    get() {
      throw new RangeError("constructor throws");
    },
  });
  try {
    Promise.resolve(throwing);
    log.push("no error");
  } catch (error) {
    log.push(`caught ${describe(error)}`);
  }

  const ownThen = Promise.resolve("own then");
  (ownThen as any).then = function (resolve: Settle): void {
    resolve("from the own then");
  };
  log.push(`own then: ${Promise.resolve(ownThen) === ownThen}`);
  await report("own then", Promise.resolve(ownThen));
  await report("own then in a subclass promise", Derived.resolve(ownThen));
}

async function values(): Promise<void> {
  await report("no argument", Promise.resolve());
  await report("number", resolveNumberOrPoint(1.5));
  await report("instance where a number may come", resolveNumberOrPoint(new Point(16, 17)));
  await report("string", resolveStringOrPoint("text"));
  await report("instance where a string may come", resolveStringOrPoint(new Point(18, 19)));
  for (const value of [undefined, null, true, 0, NaN, "", 10n, Symbol("symbol"), [1, 2]]) await report(typeof value, resolveAnything(value));

  const callable = function (): void {};
  (callable as any).then = (resolve: Settle): void => resolve("from a function");
  await report("function with a then", resolveAnything(callable));

  const list = [1, 2];
  (list as any).then = (resolve: Settle): void => resolve("from an array");
  await report("array with a then", resolveAnything(list));

  await report(
    "literal with a then",
    Promise.resolve({
      then(resolve: Settle): void {
        resolve("from a literal");
      },
    }),
  );
}

async function hotLoop(): Promise<void> {
  let direct = 0;
  let adopted = 0;
  for (let i = 0; i < 20000; i++) {
    const point = new Point(i, -i);
    if (i % 1000 === 999) (point as any).then = (resolve: Settle): void => resolve(i);
    const value = await resolvePoint(point);
    if (value === point) direct++;
    else if (value === i) adopted++;
  }
  log.push(`${direct} direct, ${adopted} adopted`);
}

async function main(): Promise<void> {
  await instances();
  await prototypes();
  await promises();
  await values();
  await hotLoop();
  console.log(log.join("\n"));
}

main();

export {};
