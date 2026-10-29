// A DataView over each kind of buffer is made and written to at once, in a program in which another DataView has a property of its own.
// Flags: --aot-validate --aot-disable=flow:NarrowedTypes
const marked: DataView & { mark?: number } = new DataView(new ArrayBuffer(8));
marked.mark = 1;
function written(make: () => ArrayBufferLike): string {
  const data = new DataView(make());
  data.setFloat64(0, 1.5, true);
  data.setInt16(8, -2);
  return data.getFloat64(0, true) + " " + data.getInt16(8) + " " + data.byteLength;
}
const makers: [string, () => ArrayBufferLike][] = [
  ["fixed", () => new ArrayBuffer(32)],
  ["resizable", () => new ArrayBuffer(32, { maxByteLength: 64 })],
  ["shared", () => new SharedArrayBuffer(32)],
  ["growable", () => new SharedArrayBuffer(32, { maxByteLength: 64 })],
];
for (const [kind, make] of makers) console.log(kind, written(make), marked.mark);
