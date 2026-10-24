// `Promise.all([f(), g()])` over an array literal of calls of async functions: the order of jobs, which rejection wins, what each kind of element does, and that the result is an ordinary array.
const log: string[] = [];
const settled = Promise.resolve(0);
const collect: (sync?: boolean) => void = (globalThis as any).gc ?? (globalThis as any).Bun?.gc ?? (() => undefined);
function ticks(name: string, count: number): void {
  let chain: Promise<unknown> = settled;
  for (let i = 1; i <= count; i++) chain = chain.then(() => log.push(name + " tick " + i));
}
function text(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function atOnce(n: number): Promise<number> {
  log.push("atOnce " + n);
  return n;
}
async function later(n: number, turns: number): Promise<number> {
  log.push("later enters " + n);
  for (let i = 0; i < turns; i++) await settled;
  log.push("later ends " + n);
  return n;
}
async function object(n: number): Promise<{ n: number }> {
  if (n & 1) await settled;
  return { n };
}
async function failsAtOnce(n: number): Promise<number> {
  throw new Error("fails at once " + n);
}
async function failsLater(n: number, turns: number): Promise<number> {
  for (let i = 0; i < turns; i++) await settled;
  throw new Error("fails later " + n);
}
async function givesPromise(n: number): Promise<number> {
  return Promise.resolve(n);
}
async function givesThenable(n: number): Promise<number> {
  await settled;
  return { then(resolve: (value: number) => void) { log.push("the thenable is asked " + n); resolve(n); } } as PromiseLike<number>;
}
async function nested(n: number): Promise<number> {
  const [a, b] = await Promise.all([later(n, 1), atOnce(n + 1)]);
  return a + b;
}
function throwsPlainly(): number {
  throw new Error("thrown while the list is made");
}
const thenable: PromiseLike<string> = { then(resolve: any) { log.push("the plain thenable is asked"); resolve("from a thenable"); return undefined as any; } };

async function show(name: string, run: () => Promise<unknown>): Promise<void> {
  ticks(name, 9);
  try {
    log.push(name + " gives " + JSON.stringify(await run()));
  } catch (error) {
    log.push(name + " throws " + text(error));
  }
  for (let i = 0; i < 12; i++) await settled;
}

async function main(): Promise<void> {
  await show("both at once", async () => await Promise.all([atOnce(1), atOnce(2)]));
  await show("both later", async () => await Promise.all([later(1, 1), later(2, 3)]));
  await show("the first is slower", async () => await Promise.all([later(1, 4), later(2, 1), atOnce(3)]));
  await show("objects", async () => await Promise.all([object(1), object(2), object(3)]));
  await show("one element", async () => await Promise.all([later(1, 2)]));
  await show("no element", async () => await Promise.all([]));
  await show("values among calls", async () => await Promise.all([1, atOnce(2), "three", later(4, 1), null, undefined, { five: 5 }]));
  await show("promises among calls", async () => await Promise.all([settled, atOnce(2), Promise.resolve("three"), later(4, 2), new Promise(resolve => settled.then(() => resolve("five")))]));
  await show("a thenable among calls", async () => await Promise.all([later(1, 1), thenable, atOnce(3)]));
  await show("results that are promises", async () => await Promise.all([givesPromise(1), givesThenable(2), atOnce(3)]));
  await show("a conditional element", async () => await Promise.all([atOnce(1), log.length > 0 ? later(2, 1) : null, log.length < 0 ? later(3, 1) : null]));
  await show("an await in the list", async () => await Promise.all([later(1, 1), await later(2, 3), later(3, 1)]));
  await show("nested", async () => await Promise.all([nested(1), nested(10), Promise.all([atOnce(20), later(21, 2)])]));
  await show("fails at once", async () => await Promise.all([failsAtOnce(1), later(2, 2)]));
  await show("fails later", async () => await Promise.all([later(1, 3), failsLater(2, 1)]));
  await show("two fail, the second first", async () => await Promise.all([failsLater(1, 3), failsLater(2, 1), later(3, 5)]));
  await show("two fail at once", async () => await Promise.all([failsAtOnce(1), failsAtOnce(2)]));
  await show("the list is never made", async () => await Promise.all([later(1, 2), atOnce(2), throwsPlainly()]));
  await show("the pattern", async () => {
    const [a, { n }, c = "default"] = await Promise.all([later(1, 1), object(2), undefined]);
    return [a, n, c];
  });
  await show("the promise is kept", async () => {
    const all = Promise.all([later(1, 2), atOnce(2)]);
    log.push("kept is a promise " + (all instanceof Promise));
    all.then(values => log.push("then sees " + values.join()));
    const first = await all;
    const second = await all;
    return [first === second, Array.isArray(first), first.length];
  });
  await show("the result is an ordinary array", async () => {
    const values = await Promise.all([atOnce(1), later(2, 1)]);
    values.push(3);
    values[0] = 10;
    return [values, Object.getPrototypeOf(values) === Array.prototype, Object.keys(values)];
  });
  await show("not awaited", async () => {
    void Promise.all([later(1, 1), atOnce(2)]).then(values => log.push("unawaited gives " + values.join()));
    return "went on";
  });
  await show("returned", () => Promise.all([later(1, 1), atOnce(2)]));
  await show("in a plain function", async () => await ((): Promise<number[]> => Promise.all([later(1, 1), atOnce(2)]))());
  await show("with collections", async () => {
    const all = Promise.all([object(1), object(3), later(5, 4)]);
    collect(true);
    await settled;
    collect(true);
    const values = await all;
    collect(true);
    return values;
  });
  const many: Promise<number[]>[] = [];
  for (let i = 0; i < 100; i++) many.push(Promise.all([later(i, i % 4), atOnce(i), nested(i)]));
  const sums = (await Promise.all(many)).map(([a, b, c]) => a + b + c);
  log.push("many " + sums.reduce((a, b) => a + b, 0));
}

main().then(() => {
  let hash = 0;
  for (const line of log) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
  for (const line of log.slice(0, 420)) console.log(line);
  console.log(log.length + " lines, hash " + hash);
});
