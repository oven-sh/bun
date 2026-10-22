// Methods found through instances: Array.fromAsync, ReadableStream.from and Readable.from call next of an async iterator without an argument and return with a reason or nothing; the program's own calls pass numbers.
import { Readable } from "node:stream";

let total = 0;

class Ticks {
  constructor(public left: number) {}
  [Symbol.asyncIterator](): this {
    return this;
  }
  async next(step: number): Promise<IteratorResult<string>> {
    total += typeof step === "number" ? 1 : step === undefined ? 100 : 10000;
    return --this.left >= 0 ? { done: false, value: "t" + this.left } : { done: true, value: undefined };
  }
  async return(reason: number): Promise<IteratorResult<string>> {
    total += typeof reason === "number" ? 100000 : reason === undefined ? 1000000 : typeof reason === "string" ? 10000000 : 100000000;
    return { done: true, value: undefined };
  }
}

const own = new Ticks(1);
await own.next(1);
await own.return(1);
const counts: number[] = [(await Array.fromAsync(new Ticks(2) as any)).length];
const reader = (ReadableStream as any).from(new Ticks(5)).getReader();
await reader.read();
await reader.cancel("enough");
let chunks = 0;
for await (const chunk of Readable.from(new Ticks(3) as any)) chunks += String(chunk).length;
for await (const tick of new Ticks(4) as any) if (tick === "t2") break;
console.log(total, counts.join(), chunks);
