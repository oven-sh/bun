// A source that waits for something outside the pipeline wakes up while all its consumers are suspended. Each case logs the order in which the layers, other jobs and clean-up code run.
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<string>();
let lines: string[] = [];
const log = (text: string) => { lines.push(text); };
const show = (value: unknown): string => (value === undefined ? "undefined" : JSON.stringify(value));
type Stream = AsyncGenerator<any, any, any>;
let deliver: (value: any) => void = () => {};
let fail: (error: Error) => void = () => {};
const arrival = () => new Promise<any>((resolve, reject) => { deliver = resolve; fail = reject; });
const turns = async (count: number) => { for (let i = 0; i < count; i++) await null; };
async function* source(count: number): Stream {
  try {
    for (let i = 0; i < count; i++) { const value = await arrival(); log("source has " + show(value)); yield value; }
    return "source ended";
  } finally { log("source cleans up"); }
}
async function* relay(name: string, input: AsyncIterable<any>): Stream {
  try {
    for await (const value of input) { log(name + " has " + show(value)); yield value; log(name + " goes on"); }
  } finally { log(name + " cleans up"); }
}
async function* delegate(name: string, input: Stream): Stream {
  const result = yield* input;
  log(name + " got " + show(result));
  return result;
}
async function* throwsAt(limit: number, input: AsyncIterable<any>): Stream {
  let seen = 0;
  for await (const value of input) { if (++seen === limit) throw new Error("layer failed at " + seen); yield value; }
}
async function consume(name: string, input: AsyncIterable<any>, stopAt = Infinity): Promise<string> {
  let seen = 0;
  try {
    for await (const value of input) {
      log(name + " has " + show(value));
      Promise.resolve().then(() => log(name + "'s job"));
      if (++seen === stopAt) break;
    }
  } catch (error) { log(name + " caught " + (error as Error).message); }
  return name + " saw " + seen;
}
async function scene(title: string, run: () => Promise<void>) {
  lines = [];
  await run();
  await turns(40);
  console.log(title + ": " + lines.join(" | "));
}

await scene("three layers", async () => {
  const done = consume("top", relay("b", relay("a", source(2))));
  for (const value of [1, { v: 2 }, 3]) { await turns(10); log("deliver"); deliver(value); }
  log(await done);
});
await scene("delegation", async () => {
  const done = consume("top", delegate("outer", delegate("inner", source(2))));
  for (const value of ["x", "y", "z"]) { await turns(10); log("deliver"); deliver(value); }
  log(await done);
});
await scene("another job is queued first", async () => {
  const done = consume("top", relay("a", source(2)));
  await turns(10);
  deliver(1); Promise.resolve().then(() => log("job behind the delivery")).then(() => log("second job"));
  await turns(10);
  Promise.resolve().then(() => log("job in front of the delivery")); deliver(2);
  await turns(10); deliver(3);
  log(await done);
});
await scene("a layer throws", async () => {
  const done = consume("top", relay("b", throwsAt(2, relay("a", source(5)))));
  for (const value of [1, 2]) { await turns(10); deliver(value); }
  log(await done);
});
await scene("the source is rejected", async () => {
  const done = consume("top", relay("a", source(5)));
  await turns(10); deliver(1); await turns(10); fail(new Error("no more"));
  log(await done);
});
await scene("the consumer leaves", async () => {
  const done = consume("top", relay("b", relay("a", source(5))), 2);
  for (const value of [1, 2]) { await turns(10); deliver(value); }
  log(await done);
});
await scene("promises and thenables are yielded", async () => {
  async function* unwraps(input: AsyncIterable<any>): Stream { for await (const box of input) yield box[0]; }
  const done = consume("top", relay("b", unwraps(relay("a", source(5)))));
  const thenable = { then(resolve: (value: string) => void) { log("then is called"); resolve("from then"); } };
  for (const value of [Promise.resolve("settled"), thenable, [thenable], null, turns(3).then(() => "late"), 0]) { await turns(16); deliver([value]); }
  log(await done);
});
await scene("several requests wait", async () => {
  const middle = relay("a", source(3));
  const requests = [middle.next(), middle.next(), middle.next("sent")];
  for (const value of [1, 2, 3]) { await turns(10); deliver(value); }
  for (const request of requests) log(show(await request));
  log(show(await middle.return("closed")));
});
await scene("two consumers share a generator", async () => {
  const shared = relay("shared", source(4));
  const both = [consume("first", shared), consume("second", shared)];
  for (const value of [1, 2, 3, 4, 5]) { await turns(12); deliver(value); }
  for (const each of both) log(await each);
});
await scene("async contexts", async () => {
  async function* reads(name: string, input: AsyncIterable<any>): Stream { for await (const value of input) { log(name + " in " + storage.getStore()); yield value; } }
  const done = storage.run("consumer", async () => { for await (const value of reads("b", storage.run("inner", () => reads("a", source(2))))) log("top in " + storage.getStore() + " has " + value); });
  for (const value of [1, 2, 3]) { await turns(10); storage.run("deliverer " + value, () => deliver(value)); }
  await done;
});
await scene("collections between the layers", async () => {
  async function* collects(input: AsyncIterable<any>): Stream { for await (const value of input) { Bun.gc(true); yield { kept: value, more: [value, value] }; } }
  const done = consume("top", collects(collects(source(2))));
  for (const value of [{ a: 1 }, "text" + lines.length, 3]) { await turns(10); deliver(value); Bun.gc(true); }
  log(await done);
});
await scene("two hundred layers", async () => {
  let stream: Stream = source(2);
  for (let i = 0; i < 100; i++) stream = delegate2(plain(stream));
  let sum = 0;
  const done = (async () => { for await (const value of stream) sum += value; })();
  for (const value of [5, 7, 9]) { await turns(400); deliver(value); }
  await done; log("sum " + sum);
});
async function* plain(input: AsyncIterable<any>): Stream { for await (const value of input) yield value + 1; }
async function* delegate2(input: Stream): Stream { return yield* input; }
await scene("errors name the layers", async () => {
  async function* inner(input: AsyncIterable<any>): Stream { for await (const value of input) yield value; }
  async function outer(input: AsyncIterable<any>) { for await (const value of input) { const names = (new Error("here").stack ?? "").split("\n").slice(1).map(line => /at (?:async )?([\w.]+)/.exec(line)?.[1] ?? "?"); log(value + " in " + names.filter(name => name === "outer" || name === "inner" || name === "source").join(",")); } }
  const done = outer(inner(source(1)));
  await turns(10); deliver("a"); await turns(10); deliver("b");
  await done;
});
