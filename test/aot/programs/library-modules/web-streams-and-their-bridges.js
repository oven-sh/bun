// node:stream/web and the global stream classes: a ReadableStream with a controller, a TransformStream, a WritableStream, tee, text encoder and decoder streams, compression, and the bridges to node:stream.
import { ReadableStream, TransformStream, WritableStream, TextDecoderStream, TextEncoderStream, CompressionStream, DecompressionStream } from "node:stream/web";
import { Readable, Writable } from "node:stream";

const numbers = () => new ReadableStream({ start(controller) { for (const n of [1, 2, 3]) controller.enqueue(n); controller.close(); } });
const doubled = numbers().pipeThrough(new TransformStream({ transform(n, controller) { controller.enqueue(n * 2); } }));
const seen = [];
await doubled.pipeTo(new WritableStream({ write(n) { seen.push(n); } }));
console.log(seen.join());

const [left, right] = numbers().tee();
const read = async stream => { const all = []; for await (const value of stream) all.push(value); return all.join(); };
console.log(await read(left), await read(right));

const words = new ReadableStream({ start(controller) { controller.enqueue("grüße"); controller.close(); } });
console.log(await read(words.pipeThrough(new TextEncoderStream()).pipeThrough(new TextDecoderStream())));

const packed = new Response("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").body.pipeThrough(new CompressionStream("gzip"));
console.log(await new Response(packed.pipeThrough(new DecompressionStream("gzip"))).text());

console.log(await read(Readable.toWeb(Readable.from(["a", "b"]))));
const fromWeb = [];
for await (const value of Readable.fromWeb(numbers(), { objectMode: true })) fromWeb.push(value);
console.log(fromWeb.join());
const sink = [];
const writer = Writable.toWeb(new Writable({ write(chunk, encoding, done) { sink.push(chunk.toString()); done(); } })).getWriter();
await writer.write("through the bridge");
await writer.close();
console.log(sink.join());

const reader = numbers().getReader();
console.log(JSON.stringify(await reader.read()), numbers().locked, ReadableStream === globalThis.ReadableStream);
const failing = new ReadableStream({ pull() { throw new RangeError("pull failed"); } });
console.log(await failing.getReader().read().catch(error => error.name + " " + error.message));
