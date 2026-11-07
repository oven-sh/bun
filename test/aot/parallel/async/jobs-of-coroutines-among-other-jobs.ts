// The jobs that finish a yield, resume a consumer and go on behind an await, each in its place among the jobs of promises, of queueMicrotask and of other coroutines.
import { AsyncLocalStorage } from "node:async_hooks";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
function show(value: unknown): string {
  if (value instanceof Error) return value.constructor.name + ": " + value.message;
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function ticks(name: string, count: number) {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(() => log(name + " tick " + i));
}
function jobs(name: string, count: number) {
  let i = 0;
  const job = () => { log(name + " job " + i); if (++i < count) queueMicrotask(job); };
  queueMicrotask(job);
}
function later<T>(value: T, turns: number): Promise<T> {
  let promise: Promise<any> = Promise.resolve(value);
  for (let i = 0; i < turns; i++) promise = promise.then(x => x);
  return promise;
}
function fails(message: string, turns: number): Promise<never> {
  return later(0, turns).then(() => { throw new Error(message); });
}

async function* plain(name: string, count: number): AsyncGenerator<number, string> {
  for (let i = 0; i < count; i++) { log(name + " yields " + i); yield i; }
  return name + " end";
}
async function* waits(name: string, count: number, turns: number): AsyncGenerator<number, string> {
  for (let i = 0; i < count; i++) { log(name + " waits"); await later(0, turns); log(name + " yields " + i); yield i; }
  await null;
  return name + " end";
}
async function* relay(name: string, source: AsyncGenerator<number, string>): AsyncGenerator<number, string> {
  for await (const value of source) { log(name + " relays " + value); yield value + 100; }
  return name + " end";
}
async function loop(name: string, source: AsyncIterable<unknown>, stopAt?: unknown): Promise<string> {
  try {
    for await (const value of source) {
      log(name + " sees " + show(value));
      if (value === stopAt) { log(name + " leaves"); break; }
    }
    return name + " through";
  } catch (error) {
    return name + " caught " + show(error);
  }
}
async function scene(name: string, run: () => Promise<unknown>[] | Promise<unknown>) {
  log("== " + name);
  const started = run();
  for (const result of await Promise.allSettled(Array.isArray(started) ? started : [started])) log(name + ": " + show(result.status === "fulfilled" ? result.value : result.reason));
}

await scene("side by side", () => { ticks("a", 8); jobs("b", 8); return [loop("c", plain("d", 3)), loop("e", waits("f", 3, 1)), loop("g", plain("h", 2))]; });
await scene("relays", () => { ticks("a", 10); return [loop("b", relay("c", relay("d", plain("e", 3)))), loop("f", relay("g", waits("h", 2, 2)))]; });

async function* catches(name: string): AsyncGenerator<string> {
  try { await fails(name + " first", 1); } catch (error) { log(name + " caught " + show(error)); yield "recovered"; }
  try { yield fails(name + " yielded", 0) as never; } catch (error) { log(name + " caught " + show(error)); yield "again"; }
  await fails(name + " last", 2);
  yield "never";
}
await scene("rejections go into the body", () => { ticks("a", 12); jobs("b", 6); return [loop("c", catches("d")), loop("e", relay("f", catches("g") as never))]; });

async function* yieldsPromises(name: string): AsyncGenerator<unknown> {
  yield later(name + " later", 3);
  yield Promise.resolve(name + " settled");
  yield { then(resolve: (value: string) => void) { log(name + " then is called"); resolve(name + " thenable"); } };
  yield { value: 1, done: true };
  return later(name + " returned", 1);
}
await scene("what is yielded is awaited", () => { ticks("a", 14); return [loop("b", yieldsPromises("c")), loop("d", yieldsPromises("e"))]; });

await scene("requests by hand among the steps", () => {
  const generator = waits("a", 4, 1);
  ticks("b", 10);
  const first = generator.next().then(result => "by hand " + show(result));
  const looped = loop("c", { [Symbol.asyncIterator]: () => generator });
  const second = generator.next().then(result => "by hand " + show(result));
  return [first, looped, second];
});
await scene("closed while a job is queued", () => {
  const generator = plain("a", 5);
  const looped = loop("b", { [Symbol.asyncIterator]: () => generator });
  const closed = later(0, 2).then(() => generator.return("closed")).then(result => "return " + show(result));
  const thrown = later(0, 5).then(() => generator.throw(new Error("thrown in"))).then(result => "throw " + show(result), error => "throw failed " + show(error));
  jobs("c", 8);
  return [looped, closed, thrown];
});
await scene("left early", () => { ticks("a", 8); return [loop("b", relay("c", waits("d", 4, 1)), 101), loop("e", plain("f", 4), 0)]; });

const storage = new AsyncLocalStorage<string>();
async function* reads(name: string, count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) { await null; yield name + " made under " + storage.getStore(); }
}
async function readsLoop(name: string, source: AsyncGenerator<string>): Promise<string> {
  for await (const value of source) log(name + " under " + storage.getStore() + ": " + value);
  await null;
  return name + " ends under " + storage.getStore();
}
await scene("each under its own store", () => {
  const shared = storage.run("maker", () => reads("shared", 4));
  return [
    storage.run("one", () => readsLoop("a", reads("b", 3))),
    storage.run("two", () => readsLoop("c", reads("d", 3))),
    readsLoop("e", reads("f", 2)),
    storage.run("three", () => readsLoop("g", shared)),
  ];
});

async function step(generator: AsyncGenerator<number, string>): Promise<string> {
  const { value, done } = await generator.next();
  return show(value) + " " + done;
}
await scene("every step in a call of its own", async () => {
  const generator = waits("a", 2, 1);
  ticks("b", 12);
  const all: string[] = [];
  for (let i = 0; i < 4; i++) all.push(await step(generator));
  return all.join(", ");
});
await scene("many at once", () => {
  const all: Promise<string>[] = [];
  for (let i = 0; i < 6; i++) all.push(loop("l" + i, i % 2 ? relay("r" + i, plain("p" + i, i)) : waits("w" + i, i >> 1, i % 3)));
  return all;
});

async function* grows(count: number): AsyncGenerator<number[]> {
  for (let i = 0; i < count; i++) { await null; yield Array.from({ length: 50 }, (_, k) => k + i); }
}
await scene("with garbage", async () => {
  let sum = 0;
  for await (const list of grows(400)) sum += list[49];
  return sum;
});
async function* quiet(count: number, turns: number): AsyncGenerator<number> {
  for (let i = 0; i < count; i++) { if (turns) await later(0, turns); yield i; }
}
await scene("thousands at once", async () => {
  async function sumOf(source: AsyncIterable<number>): Promise<number> {
    let sum = 0;
    for await (const value of source) sum += value;
    return sum;
  }
  const all: Promise<number>[] = [];
  for (let i = 0; i < 6000; i++) {
    const generator = quiet(3, i % 3);
    if (i % 5 === 0) generator.next();
    all.push(sumOf(i % 2 ? generator : { [Symbol.asyncIterator]: () => generator }));
  }
  return (await Promise.all(all)).reduce((a, b) => a + b, 0);
});
await scene("a trace inside a body that a job resumed", async () => {
  async function* traced(): AsyncGenerator<boolean> { await null; yield String(new Error("here").stack).includes("traced"); }
  let seen = "";
  for await (const value of traced()) seen += value;
  return seen;
});

console.log(lines.join("\n"));
