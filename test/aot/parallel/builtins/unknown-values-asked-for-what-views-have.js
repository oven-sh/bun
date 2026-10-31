// Values that no analysis can follow are asked for what the views of a buffer have.
const given = JSON.parse('{"list":[]}');
const bytes = new ArrayBuffer(64);
class Chunk extends Uint8Array {
  get byteOffset() {
    return -1;
  }
}
const shadowed = new Uint8Array(bytes, 8, 8);
Object.defineProperty(shadowed, "byteLength", { value: "own" });
const resizable = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 32 }), 4);
const detached = new Uint8Array(new ArrayBuffer(8), 2, 4);
given.list.push(
  Buffer.alloc(12, 1),
  Buffer.from(bytes, 4, 6),
  new Uint8Array(bytes, 16, 5),
  new Float64Array(bytes, 8, 3),
  new Int16Array(bytes, 2),
  new BigUint64Array(2),
  new DataView(bytes, 3, 9),
  new Chunk(bytes, 1, 2),
  shadowed,
  resizable,
  detached,
  { byteOffset: "offset", byteLength: "length", buffer: "buffer", length: 3 },
  { byteLength: 7 },
  "text",
  42,
  Object.create(new Uint8Array(3)),
);
function span(view) {
  return view.byteOffset + ":" + view.byteLength;
}
function three(view) {
  return view.length + view.byteLength + view.byteOffset;
}
function whole(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).length;
}
function attempt(work, view) {
  try {
    return String(work(view));
  } catch (error) {
    return error.constructor.name;
  }
}
function round() {
  const lines = [];
  for (const view of given.list)
    lines.push(attempt(span, view) + " " + attempt(three, view) + " " + attempt(whole, view));
  lines.push(attempt(span, null), attempt(three, undefined));
  return lines.join("\n");
}
console.log(round());
resizable.buffer.resize(6);
structuredClone(detached.buffer, { transfer: [detached.buffer] });
console.log(round());
