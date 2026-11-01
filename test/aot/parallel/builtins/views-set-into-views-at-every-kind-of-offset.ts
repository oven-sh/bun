// `target.set(source, offset)` where both are views of one kind of element, with offsets of every kind, views that overlap, views without
// elements, views of buffers that were detached or can be resized, and sources of another kind.
function attempt(work: () => unknown): string {
  try {
    return String(work());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function bytes(count: number, first: number): Uint8Array {
  const view = new Uint8Array(count);
  for (let i = 0; i < count; i++) view[i] = first + i;
  return view;
}

function setBytes(target: Uint8Array, source: Uint8Array, offset: number): string {
  return attempt(() => {
    target.set(source, offset);
    return target.join();
  });
}

function setBytesAtTheStart(target: Uint8Array, source: Uint8Array): string {
  return attempt(() => {
    target.set(source);
    return target.join();
  });
}

const offsets = [0, 1, 3, 4, 5, -0, -0.5, -1, 0.9, 2.5, 3.999, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 53, 2 ** 63, 2 ** 64, -(2 ** 63), 1e300, Number.MIN_VALUE];
for (const offset of offsets) console.log("offset", offset, setBytes(new Uint8Array(6), bytes(3, 1), offset));
for (let count = 0; count <= 70; count++) {
  const target = new Uint8Array(72);
  console.log("count", count, setBytes(target, bytes(count, 1), 1) === [0, ...bytes(count, 1), ...new Array(71 - count).fill(0)].join());
}
console.log("start", setBytesAtTheStart(new Uint8Array(4), bytes(2, 7)), setBytesAtTheStart(new Uint8Array(1), bytes(2, 7)));

for (let count = 1; count <= 40; count++) {
  for (const [from, to] of [[0, 1], [1, 0], [0, 3], [3, 0], [0, 0], [5, 21], [21, 5]]) {
    const whole = bytes(64, 0);
    const expected = Array.from(whole);
    expected.splice(to, count, ...Array.from(whole).slice(from, from + count));
    whole.set(whole.subarray(from, from + count), to);
    if (whole.join() !== expected.join()) console.log("overlap differs", count, from, to, whole.join());
  }
}
console.log("overlaps done");

const chunks: Uint8Array[] = [bytes(2, 1), Buffer.from("ab"), new Uint8Array(0), Buffer.alloc(0), Buffer.from("a longer piece of text that has more than 32 bytes"), bytes(33, 5)];
const writer = { view: new Uint8Array(128), written: 0 };
for (let turn = 0; turn < 3; turn++) {
  for (const chunk of chunks) {
    if (chunk.byteLength > writer.view.length - writer.written) writer.written = 0;
    writer.view.set(chunk, writer.written);
    writer.written += chunk.byteLength;
  }
}
console.log("chunks", writer.written, writer.view.join());

const intoBuffer = Buffer.alloc(8);
intoBuffer.set(bytes(3, 9), 2);
intoBuffer.set(Buffer.from("xy"), 6);
console.log("buffer", intoBuffer.join(), attempt(() => intoBuffer.set(Buffer.from("xyz"), 6)));

function setFloats(target: Float64Array, source: Float64Array, offset: number): string {
  return attempt(() => {
    target.set(source, offset);
    return new Uint8Array(target.buffer).join();
  });
}
const floats = new Float64Array(new BigUint64Array([0x7ff8000000000001n, 0xfff0000000000000n, 0x7ff4000000000002n]).buffer);
console.log("floats", setFloats(new Float64Array(4), floats, 1), setFloats(new Float64Array(4), floats, 2));

function setShorts(target: Int16Array, source: Int16Array, offset: number): string {
  return attempt(() => {
    target.set(source, offset);
    return target.join();
  });
}
console.log("shorts", setShorts(new Int16Array(5), Int16Array.of(-1, 300, -32768), 2), setShorts(new Int16Array(5), Int16Array.of(-1, 300, -32768), 3));

function setBigs(target: BigInt64Array, source: BigInt64Array, offset: number): string {
  return attempt(() => {
    target.set(source, offset);
    return target.join();
  });
}
console.log("bigs", setBigs(new BigInt64Array(3), BigInt64Array.of(-1n, 2n ** 62n), 1), setBigs(new BigInt64Array(3), BigInt64Array.of(-1n, 2n), 2));

function setClamped(target: Uint8ClampedArray, source: Uint8Array | Int16Array, offset: number): string {
  return attempt(() => {
    target.set(source, offset);
    return target.join();
  });
}
console.log("other kinds", setClamped(new Uint8ClampedArray(4), bytes(2, 254), 1), setClamped(new Uint8ClampedArray(4), Int16Array.of(-5, 300), 2));

function detached(count: number): Uint8Array {
  const view = new Uint8Array(count);
  structuredClone(view.buffer, { transfer: [view.buffer] });
  return view;
}
console.log("detached target", setBytes(detached(4), bytes(0, 0), 0), setBytes(detached(4), bytes(1, 0), 0), setBytes(detached(0), bytes(0, 0), 0));
console.log("detached source", setBytes(new Uint8Array(4), detached(2), 0), setBytes(new Uint8Array(4), detached(0), 0), setBytesAtTheStart(new Uint8Array(4), detached(2)));

const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
const tracking = new Uint8Array(resizable);
const fixedPart = new Uint8Array(resizable, 2, 4);
console.log("resizable", setBytes(tracking, bytes(3, 1), 5), setBytes(tracking, bytes(3, 1), 6), setBytes(fixedPart, bytes(2, 8), 2));
resizable.resize(12);
console.log("grown", setBytes(tracking, bytes(3, 4), 9), setBytes(new Uint8Array(16), tracking, 4));
resizable.resize(4);
console.log("shrunk", setBytes(tracking, bytes(3, 4), 1), setBytes(fixedPart, bytes(0, 0), 0), setBytes(new Uint8Array(8), fixedPart, 0));

class Named extends Uint8Array {
  get length(): number {
    return 1;
  }
  get byteLength(): number {
    return 1;
  }
}
const named = new Named(3);
named[2] = 7;
console.log("heir", setBytes(new Uint8Array(4), named, 1), setBytes(named, bytes(3, 1), 0));
