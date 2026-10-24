// What an async function returns decides how many turns its caller's await takes: plain values, promises, subclassed promises, thenables, objects whose `then` is a getter, a Proxy.
const log: string[] = [];
const settled = Promise.resolve(0);
function ticks(name: string, count: number): void {
  let chain: Promise<unknown> = settled;
  for (let i = 1; i <= count; i++) chain = chain.then(() => log.push(name + " tick " + i));
}
class Later<T> extends Promise<T> {
  static made = 0;
  constructor(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void) {
    super(executor);
    Later.made++;
  }
  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    log.push("Later.then is called");
    return super.then(onFulfilled, onRejected);
  }
}
let thenReads = 0;
function thenable(value: number, how: string): PromiseLike<number> {
  return {
    then(resolve: any, reject: any): any {
      log.push("thenable " + value + " is asked, " + how);
      if (how === "at once") resolve(value);
      else if (how === "later") settled.then(() => resolve(value));
      else if (how === "twice") { resolve(value); resolve(value + 1); reject(new Error("ignored")); }
      else if (how === "rejects") reject(new Error("thenable " + value));
      else throw new Error("thenable throws " + value);
    },
  };
}
function withGetter(value: number, then: unknown): { value: number } {
  return Object.defineProperty({ value }, "then", { get() { thenReads++; log.push("then is read of " + value); return then; }, configurable: true });
}

async function aPromise(n: number): Promise<number> {
  return Promise.resolve(n);
}
async function aPendingPromise(n: number): Promise<number> {
  return new Promise<number>(resolve => settled.then(() => resolve(n)));
}
async function aRejectedPromise(n: number): Promise<number> {
  return Promise.reject(new Error("rejected " + n));
}
async function aSubclassedPromise(n: number): Promise<number> {
  return new Later<number>(resolve => resolve(n));
}
async function aThenable(n: number, how: string): Promise<number> {
  return thenable(n, how);
}
async function aThenableAfterAwait(n: number, how: string): Promise<number> {
  await settled;
  return thenable(n, how);
}
async function aPromiseAfterAwait(n: number): Promise<number> {
  await settled;
  return Promise.resolve(n);
}
async function anotherCall(n: number): Promise<number> {
  return aPromise(n);
}
async function anotherCallAwaited(n: number): Promise<number> {
  return await aPromise(n);
}
async function aGetter(n: number, then: unknown): Promise<unknown> {
  return withGetter(n, then);
}
async function aGetterAfterAwait(n: number, then: unknown): Promise<unknown> {
  await settled;
  return withGetter(n, then);
}
async function aThrowingGetter(n: number): Promise<object> {
  return Object.defineProperty({}, "then", { get() { throw new Error("then throws " + n); } });
}
async function aProxy(n: number): Promise<{ n: number }> {
  return new Proxy({ n }, { get(target, key, receiver) { log.push("the proxy is asked for " + String(key)); return Reflect.get(target, key, receiver); } });
}
async function aFunction(n: number): Promise<() => number> {
  return () => n;
}
async function aFunctionWithThen(n: number): Promise<number> {
  const f: any = () => n;
  f.then = (resolve: (value: number) => void) => { log.push("the function's then is called"); resolve(n); };
  return f;
}
class Box {
  constructor(public n: number) {}
}
class BoxWithThen {
  constructor(public n: number) {}
  then(resolve: (value: number) => void): void {
    log.push("BoxWithThen.then " + this.n);
    resolve(this.n);
  }
}
async function anInstance(n: number): Promise<Box> {
  return new Box(n);
}
async function anInstanceWithThen(n: number): Promise<number> {
  return new BoxWithThen(n) as unknown as PromiseLike<number>;
}
async function anInstanceGivenThen(n: number): Promise<unknown> {
  const box: any = new Box(n);
  box.then = (resolve: (value: string) => void) => { log.push("the box's own then " + n); resolve("own " + n); };
  return box;
}
async function anyValue(value: unknown): Promise<unknown> {
  return value;
}

async function show(name: string, run: () => Promise<unknown>): Promise<void> {
  ticks(name, 7);
  try {
    const value = await run();
    log.push(name + " gives " + (typeof value === "function" ? "a function" : JSON.stringify(value)));
  } catch (error) {
    log.push(name + " throws " + (error as Error).message);
  }
  await settled; await settled; await settled; await settled; await settled; await settled; await settled; await settled;
}

async function main(): Promise<void> {
  await show("a promise", async () => await aPromise(1));
  await show("a pending promise", async () => await aPendingPromise(2));
  await show("a rejected promise", async () => await aRejectedPromise(3));
  await show("a subclassed promise", async () => await aSubclassedPromise(4));
  for (const how of ["at once", "later", "twice", "rejects", "throws"]) {
    await show("a thenable " + how, async () => await aThenable(5, how));
    await show("a thenable after an await " + how, async () => await aThenableAfterAwait(6, how));
  }
  await show("a promise after an await", async () => await aPromiseAfterAwait(7));
  await show("another call", async () => await anotherCall(8));
  await show("another call awaited", async () => await anotherCallAwaited(9));
  await show("a getter that gives undefined", async () => await aGetter(10, undefined));
  await show("a getter that gives a number", async () => await aGetter(11, 5));
  await show("a getter that gives a function", async () => await aGetter(12, (resolve: (value: string) => void) => resolve("from the getter's function")));
  await show("a getter after an await", async () => await aGetterAfterAwait(13, undefined));
  await show("a getter that throws", async () => await aThrowingGetter(14));
  await show("a proxy", async () => (await aProxy(15)).n);
  await show("a function", async () => await aFunction(16));
  await show("a function with then", async () => await aFunctionWithThen(17));
  await show("an instance", async () => await anInstance(18));
  await show("an instance with then", async () => await anInstanceWithThen(19));
  await show("an instance given then", async () => await anInstanceGivenThen(20));
  for (const value of [undefined, null, true, 0, -0, NaN, 1.5, "", "text", 10n, Symbol.iterator, [], {}, new Map(), new Date(0), /x/, new Error("a value")]) {
    const got = await anyValue(value);
    log.push("any value " + (Object.is(got, value) ? "is the same " : "DIFFERS ") + typeof got);
  }
  await show("any value: a promise", async () => await anyValue(Promise.resolve(21)));
  await show("any value: a thenable", async () => await anyValue(thenable(22, "later")));
  await show("any value: a subclassed promise", async () => await anyValue(Later.resolve(23)));
  log.push("then was read " + thenReads + " times; Later made " + Later.made);
}

main().then(() => {
  for (const line of log) console.log(line);
});
