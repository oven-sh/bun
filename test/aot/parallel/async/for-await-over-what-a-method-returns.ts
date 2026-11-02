// `for await` over an object whose Symbol.asyncIterator method hands out an async generator: the steps, their order among other jobs, and who is called.
import { Readable } from "node:stream";

const lines: string[] = [];
function log(line: string) { lines.push(line); }
function ticks(name: string, count: number) {
  let chain = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(() => log(name + " tick " + i));
}

async function* numbers(name: string, count: number): AsyncGenerator<number, string, unknown> {
  try {
    for (let i = 0; i < count; i++) {
      log(name + " yields " + i);
      const sent = yield i;
      log(name + " got " + String(sent));
      if (i === 1) await null;
    }
    return name + " is done";
  } finally {
    log(name + " is closed");
  }
}

function from(make: () => any): AsyncIterable<number> {
  return { [Symbol.asyncIterator]() { log("opened"); return make(); } };
}

async function consume(name: string, iterable: AsyncIterable<number>, stopAt = -1) {
  ticks(name, 6);
  try {
    for await (const value of iterable) {
      log(name + " sees " + value);
      if (value === stopAt) break;
    }
    log(name + " is through");
  } catch (error) {
    log(name + " caught " + (error instanceof Error ? error.constructor.name : String(error)));
  }
}

async function* relay(name: string, iterable: AsyncIterable<number>) {
  for await (const value of iterable) {
    log(name + " relays " + value);
    yield value * 10;
  }
}

const builtinNext = Object.getPrototypeOf(numbers.prototype).next;

await consume("plain", from(() => numbers("a", 3)));
await consume("stopped", from(() => numbers("b", 3)), 1);

await consume("with a member", from(() => Object.assign(numbers("c", 3), { stream: "kept" })));

await consume("own next", from(() => {
  const generator: any = numbers("d", 3);
  generator.next = function (...sent: unknown[]) { log("own next with " + sent.length); return builtinNext.call(this, "from own next"); };
  return generator;
}));

await consume("own built-in next", from(() => Object.assign(numbers("e", 2), { next: builtinNext })));

{
  const generator: any = numbers("f", 3);
  const iterable = from(() => generator);
  ticks("late", 4);
  for await (const value of iterable) {
    log("late sees " + value);
    generator.next = () => { log("never called"); return Promise.resolve({ done: true, value: undefined }); };
  }
}

await consume("own return", from(() => {
  const generator: any = numbers("g", 3);
  const builtinReturn = generator.return;
  generator.return = function (value: unknown) { log("own return"); return builtinReturn.call(this, value); };
  return generator;
}), 0);

await consume("not a generator", from(() => ({ next: builtinNext })));
await consume("a prototype below", from(() => Object.create(numbers("h", 2))));
await consume("another prototype", from(() => Object.setPrototypeOf(numbers("i", 2), { next() { log("next of another prototype"); return { done: true }; } })));

{
  const generator = numbers("j", 4);
  const byHand = [generator.next("first by hand"), generator.next("second by hand")];
  await consume("behind requests", from(() => generator));
  for (const result of await Promise.all(byHand)) log("by hand " + JSON.stringify(result));
}

{
  const generator = numbers("k", 4);
  const both = [consume("left", from(() => generator)), consume("right", from(() => generator))];
  await Promise.all(both);
}

await consume("relayed", from(() => relay("m", from(() => numbers("l", 3)))));
await consume("relayed and stopped", from(() => relay("o", from(() => numbers("n", 3)))), 10);

async function once(iterable: AsyncIterable<number>) {
  for await (const value of iterable) return value;
  return -1;
}
{
  const generator = numbers("p", 3);
  ticks("once", 5);
  log("once " + (await once(from(() => generator))));
  log("once more " + (await once(from(() => generator))));
}

await consume("a stream", Readable.from(numbers("q", 3)));
await consume("a stream that is left", Readable.from(numbers("r", 5)), 1);

console.log(lines.join("\n"));
