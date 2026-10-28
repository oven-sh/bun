// An interface that typed arrays, buffers and views satisfy
interface Sized {
  byteLength: number;
}
function tell(v: Sized): string {
  return (
    v.byteLength + "|" + ArrayBuffer.isView(v) + "|" + (v instanceof Uint8Array) + "|" + (v instanceof ArrayBuffer)
  );
}
const list: Sized[] = [
  { byteLength: 7 },
  new Uint8Array(3),
  new ArrayBuffer(5),
  new DataView(new ArrayBuffer(2)),
  Buffer.from("abcd"),
];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
