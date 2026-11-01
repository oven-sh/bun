// `source.copy(target, targetStart, sourceStart, sourceEnd)` with positions of every kind, ranges that overlap, targets of other kinds of
// element, and views of buffers that were detached or can be resized.
function attempt(work: () => unknown): string {
  try {
    return String(work());
  } catch (error) {
    return (error as Error).constructor.name + " " + (error as { code?: string }).code;
  }
}

function letters(count: number): Buffer {
  const buffer = Buffer.alloc(count);
  for (let i = 0; i < count; i++) buffer[i] = 97 + (i % 26);
  return buffer;
}

function copyAll(source: Buffer, target: Buffer): string {
  return attempt(() => source.copy(target) + " " + target.join());
}
function copyTo(source: Buffer, target: Buffer, targetStart: number): string {
  return attempt(() => source.copy(target, targetStart) + " " + target.join());
}
function copyFrom(source: Buffer, target: Buffer, targetStart: number, sourceStart: number): string {
  return attempt(() => source.copy(target, targetStart, sourceStart) + " " + target.join());
}
function copyPart(source: Buffer, target: Buffer, targetStart: number, sourceStart: number, sourceEnd: number): string {
  return attempt(() => source.copy(target, targetStart, sourceStart, sourceEnd) + " " + target.join());
}

const positions = [0, 1, 2, 3, 4, 5, 6, 7, -0, -0.5, -1, 0.5, 2.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 53, 2 ** 53 + 2, 2 ** 63, 2 ** 64, -(2 ** 63), 1e300, Number.MIN_VALUE];
console.log("all", copyAll(letters(3), Buffer.alloc(5)), copyAll(letters(5), Buffer.alloc(3)), copyAll(letters(0), Buffer.alloc(3)), copyAll(letters(3), Buffer.alloc(0)));
for (const position of positions) {
  console.log("to", position, copyTo(letters(3), Buffer.alloc(5), position));
  console.log("from", position, copyFrom(letters(4), Buffer.alloc(5), 1, position));
  console.log("end", position, copyPart(letters(6), Buffer.alloc(5), 1, 2, position));
}
for (let count = 0; count <= 70; count++) {
  const target = Buffer.alloc(72);
  const copied = letters(count).copy(target, 1);
  if (copied !== count || target.join() !== [0, ...letters(count), ...new Array(71 - count).fill(0)].join()) console.log("count differs", count, copied);
}
for (let count = 1; count <= 40; count++) {
  for (const [from, to] of [[0, 1], [1, 0], [0, 3], [3, 0], [0, 0], [5, 21], [21, 5]]) {
    const whole = letters(64);
    const expected = Array.from(whole);
    expected.splice(to, count, ...Array.from(whole).slice(from, from + count));
    const copied = whole.copy(whole, to, from, from + count);
    if (copied !== count || whole.join() !== expected.join()) console.log("overlap differs", count, from, to, copied);
  }
}
console.log("counts and overlaps done");

function copyIntoBytes(source: Buffer, target: Uint8Array, targetStart: number): string {
  return attempt(() => source.copy(target, targetStart) + " " + target.join());
}
function copyIntoWords(source: Buffer, target: Uint32Array, targetStart: number): string {
  return attempt(() => source.copy(target as unknown as Uint8Array, targetStart) + " " + new Uint8Array(target.buffer).join());
}
function copyIntoFloats(source: Buffer, target: Float64Array, targetStart: number): string {
  return attempt(() => source.copy(target as unknown as Uint8Array, targetStart) + " " + new Uint8Array(target.buffer).join());
}
console.log("bytes", copyIntoBytes(letters(3), new Uint8Array(4), 2), copyIntoBytes(letters(3), new Uint8Array(4), 4));
console.log("words", copyIntoWords(letters(6), new Uint32Array(2), 1), copyIntoWords(letters(6), new Uint32Array(2), 5), copyIntoWords(letters(6), new Uint32Array(2), 8));
console.log("floats", copyIntoFloats(letters(9), new Float64Array(2), 3), copyIntoFloats(letters(9), new Float64Array(2), 15));
console.log("data view", attempt(() => letters(3).copy(new DataView(new ArrayBuffer(4)) as unknown as Uint8Array, 1)));
console.log("no view", attempt(() => letters(3).copy({} as Uint8Array, 1)), attempt(() => letters(3).copy(undefined as unknown as Uint8Array)));

function detached(count: number): Buffer {
  const bytes = new ArrayBuffer(count);
  const buffer = Buffer.from(bytes);
  structuredClone(bytes, { transfer: [bytes] });
  return buffer;
}
console.log("detached", copyTo(detached(4), Buffer.alloc(3), 0), copyTo(letters(2), detached(4), 0), copyFrom(detached(4), Buffer.alloc(3), 0, 1));

const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
const tracking = Buffer.from(resizable);
console.log("resizable", copyTo(letters(3), tracking, 6), copyTo(tracking, Buffer.alloc(10), 1));
resizable.resize(3);
console.log("shrunk", copyTo(letters(3), tracking, 1), copyTo(tracking, Buffer.alloc(10), 1));

const queue: Buffer[] = [letters(4), letters(0), letters(9), letters(33), letters(1)];
const writer = { view: Buffer.alloc(64), written: 0 };
for (let turn = 0; turn < 4; turn++) {
  for (const chunk of queue) {
    if (chunk.byteLength > writer.view.length - writer.written) writer.written = 0;
    writer.written += chunk.copy(writer.view, writer.written);
  }
}
console.log("queue", writer.written, writer.view.join());
