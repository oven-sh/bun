// Each loop stands over a source of its own, so nothing is known of what it binds but what that one source hands out: a promise. `for await` and `yield*` await what `next` answers, never the value in it.
const lines: string[] = [];
async function answers<T>(value: T): Promise<T> { return value; }
{
  const source1 = { [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: Promise.resolve(7) } : { done: true, value: undefined }) as never; } }; } };
  const seen: string[] = [];
  for await (const v of source1 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is plain | Promise.resolve | " + seen.join(", "));
}
{
  const source2 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: Promise.resolve(7) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source2 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is async | Promise.resolve | " + seen.join(", "));
}
{
  const source3 = { [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: Promise.resolve(7) } : { done: true, value: undefined }) }; } };
  const seen: string[] = [];
  for await (const v of source3 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is an arrow | Promise.resolve | " + seen.join(", "));
}
{
  const source4 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: Promise.resolve(7) } : { done: true, value: undefined }; }, async return() { return { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source4 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("with return | Promise.resolve | " + seen.join(", "));
}
{
  const source5 = { [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: new Promise<number>(resolve => resolve(7)) } : { done: true, value: undefined }) as never; } }; } };
  const seen: string[] = [];
  for await (const v of source5 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is plain | new Promise | " + seen.join(", "));
}
{
  const source6 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: new Promise<number>(resolve => resolve(7)) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source6 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is async | new Promise | " + seen.join(", "));
}
{
  const source7 = { [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: new Promise<number>(resolve => resolve(7)) } : { done: true, value: undefined }) }; } };
  const seen: string[] = [];
  for await (const v of source7 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is an arrow | new Promise | " + seen.join(", "));
}
{
  const source8 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: new Promise<number>(resolve => resolve(7)) } : { done: true, value: undefined }; }, async return() { return { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source8 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("with return | new Promise | " + seen.join(", "));
}
{
  const source9 = { [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: answers(7) } : { done: true, value: undefined }) as never; } }; } };
  const seen: string[] = [];
  for await (const v of source9 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is plain | an async function's answer | " + seen.join(", "));
}
{
  const source10 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: answers(7) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source10 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is async | an async function's answer | " + seen.join(", "));
}
{
  const source11 = { [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: answers(7) } : { done: true, value: undefined }) }; } };
  const seen: string[] = [];
  for await (const v of source11 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is an arrow | an async function's answer | " + seen.join(", "));
}
{
  const source12 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: answers(7) } : { done: true, value: undefined }; }, async return() { return { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source12 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("with return | an async function's answer | " + seen.join(", "));
}
{
  const source13 = { [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: new Promise<number>(resolve => setTimeout(resolve, 1, 7)) } : { done: true, value: undefined }) as never; } }; } };
  const seen: string[] = [];
  for await (const v of source13 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is plain | settles later | " + seen.join(", "));
}
{
  const source14 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: new Promise<number>(resolve => setTimeout(resolve, 1, 7)) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source14 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is async | settles later | " + seen.join(", "));
}
{
  const source15 = { [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: new Promise<number>(resolve => setTimeout(resolve, 1, 7)) } : { done: true, value: undefined }) }; } };
  const seen: string[] = [];
  for await (const v of source15 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is an arrow | settles later | " + seen.join(", "));
}
{
  const source16 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: new Promise<number>(resolve => setTimeout(resolve, 1, 7)) } : { done: true, value: undefined }; }, async return() { return { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source16 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("with return | settles later | " + seen.join(", "));
}
{
  const source17 = { [Symbol.asyncIterator]() { let i = 0; return { next() { return (i++ < 2 ? { done: false, value: Promise.resolve({ n: 7 }) } : { done: true, value: undefined }) as never; } }; } };
  const seen: string[] = [];
  for await (const v of source17 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is plain | of a record | " + seen.join(", "));
}
{
  const source18 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: Promise.resolve({ n: 7 }) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source18 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is async | of a record | " + seen.join(", "));
}
{
  const source19 = { [Symbol.asyncIterator]() { let i = 0; return { next: () => Promise.resolve(i++ < 2 ? { done: false, value: Promise.resolve({ n: 7 }) } : { done: true, value: undefined }) }; } };
  const seen: string[] = [];
  for await (const v of source19 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("next is an arrow | of a record | " + seen.join(", "));
}
{
  const source20 = { [Symbol.asyncIterator]() { let i = 0; return { async next() { return i++ < 2 ? { done: false, value: Promise.resolve({ n: 7 }) } : { done: true, value: undefined }; }, async return() { return { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of source20 as AsyncIterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise) + " " + JSON.stringify(await v));
  lines.push("with return | of a record | " + seen.join(", "));
}
class Queue implements AsyncIterable<Promise<number>> {
  [Symbol.asyncIterator](): AsyncIterator<Promise<number>> { let i = 0; return { next: async () => (i++ < 2 ? { done: false, value: Promise.resolve(i) } : { done: true, value: undefined }) }; }
}
async function overAClass(): Promise<string> {
  const seen: string[] = [];
  for await (const v of new Queue()) seen.push(typeof v + " " + ((v as unknown) instanceof Promise) + " " + (await v));
  return seen.join(", ");
}
lines.push("a class, in a function | " + (await overAClass()));
async function total(): Promise<number> { let sum = 0; for await (const promise of new Queue()) sum += await promise; return sum; }
lines.push("each awaited in the loop | " + (await total()));
async function kept(): Promise<string> { const all: unknown[] = []; for await (const promise of new Queue()) all.push(promise); return all.map(p => typeof p + " " + (p instanceof Promise)).join(", ") + " | " + (await Promise.all(all)).join(); }
lines.push("kept in a list | " + (await kept()));
class Pending implements AsyncIterable<unknown> {
  [Symbol.asyncIterator](): AsyncIterator<unknown> { let i = 0; return { next: async () => (i++ < 2 ? { done: false, value: new Promise(() => {}) } : { done: true, value: undefined }) }; }
}
{
  const seen: string[] = [];
  for await (const v of new Pending()) seen.push(typeof v + " " + (v instanceof Promise) + " " + Object.prototype.toString.call(v));
  lines.push("never settles | " + seen.join(", "));
}
class Mixed implements AsyncIterable<unknown> {
  [Symbol.asyncIterator](): AsyncIterator<unknown> { let i = 0; return { next: async () => (i++ < 2 ? { done: false, value: i === 1 ? 1 : Promise.resolve(2) } : { done: true, value: undefined }) }; }
}
{
  const seen: string[] = [];
  for await (const v of new Mixed()) seen.push(typeof v + " " + (v instanceof Promise) + " " + (await v));
  lines.push("a number, then a promise | " + seen.join(", "));
}
async function* delegates(): AsyncGenerator<unknown> { yield* new Queue(); }
{
  const seen: string[] = [];
  for await (const v of delegates()) seen.push(typeof v + " " + (v instanceof Promise) + " " + (await v));
  lines.push("through yield* | " + seen.join(", "));
}
async function* delegatesToo(): AsyncGenerator<unknown> { yield* new Queue(); }
{
  const seen: string[] = [];
  const generator = delegatesToo();
  for (let step = await generator.next(); !step.done; step = await generator.next()) seen.push(typeof step.value + " " + (step.value instanceof Promise) + " " + (await step.value));
  lines.push("through yield*, by hand | " + seen.join(", "));
}
class Ends implements AsyncIterable<number, Promise<string>> {
  [Symbol.asyncIterator](): AsyncIterator<number, Promise<string>> { let i = 0; return { next: async () => (i++ < 1 ? { done: false, value: i } : { done: true, value: Promise.resolve("the end") }) }; }
}
async function* takesTheResult(): AsyncGenerator<unknown> { const result: unknown = yield* new Ends(); yield typeof result + " " + (result instanceof Promise) + " " + (await result); }
{
  const seen: string[] = [];
  for await (const v of takesTheResult()) seen.push(String(v));
  lines.push("the result of yield* | " + seen.join(", "));
}
class Closes implements AsyncIterable<number> {
  [Symbol.asyncIterator](): AsyncIterator<number> { return { next: async () => ({ done: false, value: 1 }), return: async () => ({ done: true, value: Promise.resolve("closed") as never }) }; }
}
async function* isClosed(): AsyncGenerator<unknown> { yield* new Closes(); }
{
  const generator = isClosed();
  await generator.next();
  const closed = await generator.return(undefined);
  lines.push("what return answers through yield* | " + closed.done + " " + typeof closed.value + " " + (closed.value instanceof Promise) + " " + (await closed.value));
}
// These await each value.
async function* yields(): AsyncGenerator<unknown> { yield Promise.resolve(1); yield answers(2); }
{
  const seen: string[] = [];
  for await (const v of yields()) seen.push(typeof v + " " + (v instanceof Promise));
  lines.push("an async generator's own yield | " + seen.join(", "));
}
{
  const seen: string[] = [];
  for await (const v of [Promise.resolve(1), answers(2)]) seen.push(typeof v + " " + ((v as unknown) instanceof Promise));
  lines.push("a list | " + seen.join(", "));
}
function* sync(): Generator<Promise<number>> { yield Promise.resolve(1); yield answers(2); }
{
  const seen: string[] = [];
  for await (const v of sync()) seen.push(typeof v + " " + ((v as unknown) instanceof Promise));
  lines.push("a sync generator | " + seen.join(", "));
}
{
  const ownSync = { [Symbol.iterator]() { let i = 0; return { next() { return i++ < 2 ? { done: false, value: Promise.resolve(i) } : { done: true, value: undefined }; } }; } };
  const seen: string[] = [];
  for await (const v of ownSync as Iterable<unknown>) seen.push(typeof v + " " + (v instanceof Promise));
  lines.push("an own sync iterator | " + seen.join(", "));
}
async function* delegatesToAList(): AsyncGenerator<unknown> { yield* [Promise.resolve(1), answers(2)]; }
{
  const seen: string[] = [];
  for await (const v of delegatesToAList()) seen.push(typeof v + " " + (v instanceof Promise));
  lines.push("yield* of a list | " + seen.join(", "));
}
console.log(lines.join("\n"));
