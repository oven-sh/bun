// `for await` and `yield*` await what the method `next` of an asynchronous iterator answers, and never the value in that answer: a promise that such an iterator hands out arrives as a promise.
// Only the wrapper around a synchronous iterator awaits the values, and an async generator what it yields by itself.
const lines: string[] = [];
function log(line: string) { lines.push(line); }
function kindOf(value: unknown): string {
  return typeof value + (value instanceof Promise ? " promise" : "") + (value !== null && typeof value === "object" && "then" in value ? " thenable" : "");
}
async function answers<T>(value: T): Promise<T> { return value; }
type Make = () => unknown;
const values: [string, Make][] = [
  ["a number", () => 7],
  ["Promise.resolve", () => Promise.resolve(7)],
  ["new Promise", () => new Promise(resolve => resolve(7))],
  ["what an async function answers", () => answers(7)],
  ["one that settles later", () => new Promise(resolve => setTimeout(resolve, 1, 7))],
  ["one that never settles", () => new Promise(() => {})],
  ["of a record", () => Promise.resolve({ n: 7 })],
  ["of a promise's handler", () => Promise.resolve(3).then(n => n + 4)],
  ["a thenable", () => ({ then(resolve: (n: number) => void) { resolve(7); } })],
  ["a subclass", () => (class extends Promise<number> {}).resolve(7)],
  ["undefined", () => undefined],
];
type Source = (make: Make) => AsyncIterable<unknown>;
class Queue implements AsyncIterable<unknown> {
  make: Make;
  constructor(make: Make) { this.make = make; }
  [Symbol.asyncIterator](): AsyncIterator<unknown> { let i = 0; const make = this.make; return { next: async () => (i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }) }; }
}
const sources: [string, Source][] = [
  ["next is plain", make => ({ [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }) as unknown as Promise<IteratorResult<unknown>>; } }; } })],
  ["next is async", make => ({ [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }; } }; } })],
  ["next is an arrow", make => ({ [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }) }; } })],
  ["next answers a later promise", make => ({ [Symbol.asyncIterator]() { let i = 0; return { next: () => new Promise<IteratorResult<unknown>>(resolve => queueMicrotask(() => resolve(i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }))) }; } })],
  ["a class", make => new Queue(make)],
  ["with return", make => ({ [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }; }, async return(value?: unknown) { return { done: true, value }; } }; } })],
  ["the iterator is its own iterable", make => { let i = 0; const it = { [Symbol.asyncIterator]() { return it; }, async next() { return i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }; } }; return it; }],
  ["an async generator that delegates", make => (async function* () { return yield* new Queue(make) as AsyncIterable<unknown, unknown, unknown>; })()],
  ["two that delegate", make => (async function* () { yield* (async function* () { yield* new Queue(make); })(); })()],
  // These await each value.
  ["an async generator that yields", make => (async function* () { yield make(); yield make(); return make(); })()],
  ["a list", make => [make(), make()] as unknown as AsyncIterable<unknown>],
  ["a sync generator", make => (function* () { yield make(); yield make(); return make(); })() as unknown as AsyncIterable<unknown>],
  ["an own sync iterator", make => ({ [Symbol.iterator]() { let i = 0; return { next() { return i++ < 2 ? { done: false, value: make() } : { done: true, value: make() }; } }; } }) as unknown as AsyncIterable<unknown>],
];
const neverSettles = "one that never settles";
// The first of them awaits what it returns.
const awaitsValues = new Set(["an async generator that delegates", "an async generator that yields", "a list", "a sync generator", "an own sync iterator"]);

for (const [sourceName, source] of sources) {
  for (const [valueName, make] of values) {
    if (valueName === neverSettles && awaitsValues.has(sourceName)) continue;
    const seen: string[] = [];
    for await (const value of source(make)) seen.push(kindOf(value));
    const awaited: string[] = [];
    if (valueName !== neverSettles) for await (const value of source(make)) awaited.push(JSON.stringify(await value) ?? "undefined");
    const delegated: string[] = [];
    const outer = (async function* () { const result = yield* source(make) as AsyncIterable<unknown, unknown, unknown>; delegated.push("result " + kindOf(result)); })();
    for (let step = await outer.next(); !step.done; step = await outer.next()) delegated.push(kindOf(step.value));
    const byHand: string[] = [];
    const iterable = source(make) as Partial<AsyncIterable<unknown>>;
    if (iterable[Symbol.asyncIterator]) { const iterator = iterable[Symbol.asyncIterator]!(); for (let i = 0; i < 3; i++) { const step = await iterator.next(); byHand.push((step.done ? "done " : "") + kindOf(step.value)); } }
    log(sourceName + " | " + valueName + " | for await: " + seen.join(", ") + " | awaited: " + awaited.join(", ") + " | yield*: " + delegated.join(", ") + " | by hand: " + byHand.join(", "));
  }
}

// The commonest text: a queue of promises, each awaited in the loop. (TypeScript says that the loop binds a number.)
async function total(queue: AsyncIterable<Promise<number>>): Promise<number> { let sum = 0; for await (const promise of queue) sum += await promise; return sum; }
log("total " + (await total(new Queue(() => Promise.resolve(21)) as AsyncIterable<Promise<number>>)));
async function settled(queue: AsyncIterable<Promise<number>>) { const all: unknown[] = []; for await (const promise of queue) all.push(promise); return (await Promise.all(all)).join("+") + " of " + all.map(kindOf).join(", "); }
log("settled " + (await settled(new Queue(() => answers(5)) as AsyncIterable<Promise<number>>)));
async function chained(queue: AsyncIterable<Promise<number>>) { const out: string[] = []; for await (const promise of queue) out.push(String(await (promise as unknown as Promise<number>).then(n => n * 2))); return out.join(); }
log("chained " + (await chained(new Queue(() => Promise.resolve(4)) as AsyncIterable<Promise<number>>)));
// First a number, then a promise.
{ let i = 0; const seen: string[] = []; for await (const value of new Queue(() => (i++ ? Promise.resolve(i) : i))) seen.push(kindOf(value)); log("mixed " + seen.join(", ")); }
// A rejected promise that is handed out is nobody's error until it is awaited.
{
  const seen: string[] = [];
  for await (const value of new Queue(() => { const rejected = Promise.reject(new Error("handed out")); rejected.catch(() => {}); return rejected; })) { seen.push(kindOf(value)); try { await value; } catch (error) { seen.push("caught " + (error as Error).message); } }
  log("rejected " + seen.join(", "));
}
// What the consumer returns through a delegation, and what the inner iterator answers to it.
{
  const inner = { [Symbol.asyncIterator]() { return this; }, async next() { return { done: false, value: Promise.resolve(1) }; }, async return(value?: unknown) { return { done: true, value: Promise.resolve("closed with " + String(value)) }; } };
  const outer = (async function* () { yield* inner; })();
  log("step " + kindOf((await outer.next()).value));
  const closed = await outer.return("x" as never);
  log("return " + closed.done + " " + kindOf(closed.value));
}
log("fromAsync " + (await Array.fromAsync(new Queue(() => Promise.resolve(7)))).map(kindOf).join(", "));
console.log(lines.join("\n"));
