// `yield*` in an async generator and `for await` over what is iterable only synchronously: lists, their iterators, other collections, generators and iterators written by hand.
// Each value is awaited, each step takes its turns of the job queue, and what the consumer sends, throws or returns goes to the wrapper of the iterator.
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
async function turns(count: number) { for (let i = 0; i < count; i++) await null; }
async function drain(name: string, iterable: AsyncIterable<unknown>) {
  try { for await (const value of iterable) log(name + " got " + show(value)); log(name + " ends"); } catch (error) { log(name + " threw " + show(error)); }
}
async function* delegate(name: string, inner: Iterable<unknown>): AsyncGenerator<unknown, unknown, unknown> {
  log(name + " starts");
  try { const result = yield* inner as Iterable<unknown, unknown, unknown>; log(name + " result " + show(result)); return "returned by " + name; } finally { log(name + " finally"); }
}

log("== lists among other jobs");
for (const list of [[], [1], [1, 2, 3]]) { ticks("t" + list.length, 9); await drain("list" + list.length, delegate("d" + list.length, list)); await turns(10); }

log("== what the elements are");
{
  const thenable = { then(resolve: (value: string) => void) { log("then is called"); resolve("from a thenable"); } };
  ticks("e", 14);
  await drain("elements", delegate("d", [Promise.resolve("a promise"), thenable, undefined, null, { plain: 1 }, new Promise(resolve => setTimeout(resolve, 1, "late"))]));
  await drain("rejected", delegate("d", [1, Promise.reject(new Error("second is rejected")), 3]));
  await drain("rejected thenable", delegate("d", [{ then(_: unknown, reject: (reason: Error) => void) { reject(new Error("thenable rejects")); } }, 2]));
}

log("== iterators of lists");
{
  const list = ["a", "b", "c"];
  await drain("values", delegate("d", list.values()));
  await drain("keys", delegate("d", list.keys()));
  await drain("entries", delegate("d", list.entries()));
  const begun = list.values(); begun.next();
  await drain("begun", delegate("d", begun));
  await drain("exhausted", delegate("d", begun));
  log("left " + show(begun.next()));
  const shared = list.values();
  const first = delegate("first", shared), second = delegate("second", shared);
  log(show(await first.next()) + show(await second.next()) + show(await first.next()) + show(await second.next()) + show(await first.next()));
}

log("== other iterables");
{
  function* generator(): Generator<number, string, unknown> { try { const sent = yield 1; log("generator was sent " + show(sent)); yield 2; return "of the generator"; } finally { log("generator finally"); } }
  function list() { return arguments; }
  await drain("typed array", delegate("d", new Uint8Array([7, 8])));
  await drain("iterator of a typed array", delegate("d", new Uint8Array([7, 8]).values()));
  await drain("text", delegate("d", "h\u{1F600}"));
  await drain("set", delegate("d", new Set(["x", "y"])));
  await drain("map", delegate("d", new Map([["k", 1]])));
  await drain("arguments", delegate("d", (list as (...all: number[]) => Iterable<number>)(4, 5)));
  await drain("generator", delegate("d", generator()));
  class Sub extends Array<number> {}
  await drain("subclass", delegate("d", Sub.from([1, 2])));
  class Own extends Array<number> { *[Symbol.iterator](): ArrayIterator<number> { yield 42; } }
  await drain("own iterator method", delegate("d", Own.from([1, 2])));
  const holes = [1, , 3]; Object.defineProperty(holes, 1, { get() { log("getter of an element"); return "got"; } });
  await drain("getter", delegate("d", holes));
  await drain("array-like behind the method of lists", delegate("d", { length: 2, 0: "p", 1: "q", [Symbol.iterator]: Array.prototype.values } as unknown as Iterable<string>));
}

log("== the list changes meanwhile");
{
  const grows = [1, 2];
  for await (const value of delegate("d", grows)) { log("grows " + show(value)); if (grows.length < 4) grows.push(grows.length + 1); }
  const shrinks = [1, 2, 3, 4];
  for await (const value of delegate("d", shrinks)) { log("shrinks " + show(value)); shrinks.length = 2; }
}

log("== sent, thrown, returned");
{
  const sent = delegate("sent", [1, 2]);
  log(show(await sent.next("a")) + show(await sent.next("b")) + show(await sent.next("c")) + show(await sent.next("d")));
  ticks("r", 8);
  const returned = delegate("returned", [1, 2]);
  log(show(await returned.next())); log(show(await returned.return("asked")) + show(await returned.next()));
  const returnedPromise = delegate("returned a promise", [1, 2]);
  await returnedPromise.next(); log(show(await returnedPromise.return(Promise.resolve("asked by a promise"))));
  ticks("w", 8);
  const thrown = delegate("thrown", [1, 2]);
  log(show(await thrown.next()));
  try { log(show(await thrown.throw(new Error("into a list")))); } catch (error) { log("rejected with " + show(error)); }
  log(show(await thrown.next()));
  for await (const value of delegate("left early", [1, 2, 3])) { log("leaves at " + show(value)); break; }
  const byHand = {
    [Symbol.iterator]() { return this; }, i: 0,
    next(value: unknown) { log("next(" + show(value) + ", " + arguments.length + ")"); return { value: this.i, done: this.i++ > 1 }; },
    return(value: unknown) { log("return(" + show(value) + ")"); return { value: "closed", done: true }; },
    throw(error: unknown) { log("throw(" + show(error) + ")"); return { value: "recovered", done: false }; },
  };
  const hand = delegate("by hand", byHand);
  log(show(await hand.next("x")) + show(await hand.next("y")) + show(await hand.throw(new Error("z"))) + show(await hand.return("w")) + show(await hand.next()));
}

log("== an iterator of a list with a `next` of its own");
{
  const own = [5, 6].values(); (own as unknown as { next: unknown }).next = function () { log("own next"); return { done: true, value: "own" }; };
  await drain("own next", delegate("d", own));
  const counted = [5, 6].values(); const original = counted.next; let calls = 0;
  (counted as unknown as { next: unknown }).next = function (this: unknown) { calls++; return original.call(this); };
  await drain("counted", delegate("d", counted));
  log("calls " + calls);
  const none = [5].values(); (none as unknown as { next: unknown }).next = undefined;
  await drain("no next", delegate("d", none));
  const withReturn = [5, 6].values(); (withReturn as unknown as { return: unknown }).return = function (value: unknown) { log("own return(" + show(value) + ")"); return { done: true, value: "closed" }; };
  for await (const value of delegate("left early", withReturn)) { log("leaves at " + show(value)); break; }
  const withThrow = [5, 6].values(); (withThrow as unknown as { throw: unknown }).throw = function (error: unknown) { log("own throw(" + show(error) + ")"); return { done: false, value: "recovered" }; };
  const thrownInto = delegate("thrown into", withThrow);
  log(show(await thrownInto.next()) + show(await thrownInto.throw(new Error("e"))) + show(await thrownInto.next()) + show(await thrownInto.next()));
}

log("== for await");
{
  async function* inGenerator(list: Iterable<unknown>) { for await (const value of list) yield value; }
  ticks("f", 10);
  await drain("in a generator", inGenerator([1, Promise.resolve(2)]));
  await drain("in a generator, rejected", inGenerator([1, Promise.reject(new Error("no")), 3]));
  await drain("in a generator, iterator", inGenerator(["a", "b"].entries()));
  for await (const value of [1, 2].values()) log("in a function " + show(value));
  for await (const value of new Set([Promise.resolve("in a set")])) log("in a function " + show(value));
}

log("== many");
{
  const pending: number[] = [];
  async function* frames(count: number) { for (let i = 0; i < count; i++) { yield* pending; yield* [i]; yield* [i, i].keys(); } }
  let sum = 0;
  for await (const value of frames(3000)) sum += value;
  log("sum " + sum);
}
console.log(lines.join("\n"));
