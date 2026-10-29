// Callbacks handed over and methods found through instances: the streams call start, pull, cancel, write, abort, transform and size on class instances, with controllers, with any chunk and with any reason; the program's own calls pass numbers.
export {};

let total = 0;

class Source {
  sent = 0;
  pull(controller: number): void {
    total += typeof controller === "number" ? 1 : 100;
    if (typeof controller !== "number") (controller as any).enqueue(this.sent++ === 0 ? "chunk" : 5);
  }
  cancel(reason: number): void {
    total += typeof reason === "number" ? 10000 : typeof reason === "string" ? 100000 : 1000000;
  }
}

class Sink {
  write(chunk: number): void {
    total += typeof chunk === "number" ? 10000000 : typeof chunk === "string" ? 100000000 : 0;
  }
  abort(reason: number): void {
    total += reason === undefined ? 1000000000 : 0;
  }
}

new Source().pull(1);
new Source().cancel(1);
new Sink().write(1);
const reader = new ReadableStream(new Source() as any, { highWaterMark: 0 }).getReader();
const first = await reader.read();
const second = await reader.read();
await reader.cancel("enough");
const writer = new WritableStream(new Sink() as any, { size: chunk => (typeof chunk === "string" ? 1 : 2) }).getWriter();
await writer.write("text");
await writer.write(6);
await writer.abort();
console.log(total, first.value, second.value);
