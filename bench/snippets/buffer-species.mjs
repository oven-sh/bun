// @runtime bun,node
import { Buffer } from "node:buffer";
import { Readable, Stream } from "node:stream";
import { bench, group, run } from "../runner.mjs";

// Buffer[Symbol.species] is what the TypedArray methods and the stream internals construct.
const FastBuffer = Buffer[Symbol.species];

const arrayBuffer = new ArrayBuffer(64);
const resizable = new ArrayBuffer(64, { maxByteLength: 128 });
const growable = new SharedArrayBuffer(64, { maxByteLength: 128 });

// The same numbers, stored as doubles.
const [two, eight, ninetySix] = new Float64Array([2, 8, 96]);

const array8 = [1, 2, 3, 4, 5, 6, 7, 8];
const uint8Array100 = new Uint8Array(100);
const buffer8 = Buffer.from(array8);
const overResizable = Buffer.from(resizable);

const viewOfFixed = new Uint8Array(arrayBuffer, 8, 16);
const viewOfResizable = new Uint8Array(resizable, 8, 16);
const viewOfGrowable = new Uint8Array(growable, 8, 16);

const chunk = Buffer.alloc(64, 7);
const readable = new Readable({ read() {} });
function readAcrossChunks(n) {
  readable.push(chunk);
  readable.push(chunk);
  readable.read(n);
  return readable.read();
}

group("new Buffer[Symbol.species](arrayBuffer, byteOffset, length)", () => {
  bench("new FastBuffer(arrayBuffer, 2, 8)", () => new FastBuffer(arrayBuffer, 2, 8));
  bench("new FastBuffer(arrayBuffer, 2, 8), numbers stored as doubles", () => new FastBuffer(arrayBuffer, two, eight));
  bench("new FastBuffer(resizable ArrayBuffer, 2, 8)", () => new FastBuffer(resizable, 2, 8));
  bench("new FastBuffer(growable SharedArrayBuffer, 2, 8)", () => new FastBuffer(growable, 2, 8));
  bench("new FastBuffer(8)", () => new FastBuffer(8));
  bench("new FastBuffer(8), number stored as a double", () => new FastBuffer(eight));
});

group("new Buffer[Symbol.species](not a length, not an ArrayBuffer)", () => {
  bench("new FastBuffer()", () => new FastBuffer());
  bench("new FastBuffer(int32[8])", () => new FastBuffer(array8));
  bench("new FastBuffer(Uint8Array(100))", () => new FastBuffer(uint8Array100));
});

group("TypedArray methods of a Buffer", () => {
  bench("buffer.map(x => x)", () => buffer8.map(x => x));
  bench("Uint8Array.prototype.slice.call(buffer, 1)", () => Uint8Array.prototype.slice.call(buffer8, 1));
  bench("Uint8Array.prototype.subarray.call(buffer, 1, 5)", () => Uint8Array.prototype.subarray.call(buffer8, 1, 5));
  bench("Uint8Array.prototype.subarray.call(buffer over a resizable ArrayBuffer, 1, 5)", () =>
    Uint8Array.prototype.subarray.call(overResizable, 1, 5),
  );
});

group("streams", () => {
  bench("Stream._uint8ArrayToBuffer(view of an ArrayBuffer)", () => Stream._uint8ArrayToBuffer(viewOfFixed));
  bench("Stream._uint8ArrayToBuffer(view of a resizable ArrayBuffer)", () =>
    Stream._uint8ArrayToBuffer(viewOfResizable),
  );
  bench("Stream._uint8ArrayToBuffer(view of a growable SharedArrayBuffer)", () =>
    Stream._uint8ArrayToBuffer(viewOfGrowable),
  );
  bench("readable.read(96) across two chunks of 64", () => readAcrossChunks(96));
  bench("readable.read(96) across two chunks of 64, number stored as a double", () => readAcrossChunks(ninetySix));
});

await run();
