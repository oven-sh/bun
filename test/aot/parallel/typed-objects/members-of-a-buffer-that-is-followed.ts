// A Buffer has the cell type of a Uint8Array, so no test at run time tells that one is pristine. A Buffer that the compiler follows from its creation needs no test.
// IR= 0 sumOfNew PropGet .* key="length"
// IR= 0 sizesOfNew PropGet .* key="byte
// IR= 0 sumOfFollowed PropGet .* key="length"
export function sumOfNew(size: number): number {
  const bytes = Buffer.alloc(size, 1);
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum;
}
export function sizesOfNew(size: number): number {
  const bytes = Buffer.alloc(size);
  return bytes.byteLength + bytes.byteOffset;
}
export function sumOfFollowed(bytes: Buffer): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i];
  return sum;
}
const followed = Buffer.alloc(5, 2);
console.log(sumOfNew(7), sizesOfNew(9) >= 9, sumOfFollowed(followed));

function lengthOf(bytes: Buffer): unknown {
  return bytes.length;
}
function wordOf(bytes: Buffer): unknown {
  return bytes.readUInt8(0);
}
function firstBehindSlice(bytes: Uint8Array): number {
  const part = bytes.slice(0, 1);
  part[0] = 9;
  return bytes[0];
}
function textOf(bytes: Uint8Array): string {
  return bytes.toString();
}
const say = (name: string, run: () => unknown) => {
  let said: string;
  try {
    said = String(run());
  } catch (error) {
    said = "throws " + (error as Error).name;
  }
  console.log(name + ": " + said);
};
const everyWay = (name: string, make: () => any) => {
  say(name + ", length", () => lengthOf(make()));
  say(name + ", word", () => wordOf(make()));
  say(name + ", slice", () => firstBehindSlice(make()));
  say(name + ", text", () => textOf(make()));
};
everyWay("a buffer", () => Buffer.from([1, 2, 3]));
everyWay("plain bytes", () => new Uint8Array([1, 2, 3]));
everyWay("own length", () => Object.defineProperty(Buffer.from([1, 2, 3]), "length", { value: 77 }));
everyWay("own readUInt8", () => Object.assign(Buffer.from([1, 2, 3]), { readUInt8: () => "own" }));
everyWay("own slice", () => Object.assign(Buffer.from([1, 2, 3]), { slice: () => [0] }));
everyWay("the prototype of plain bytes", () => Object.setPrototypeOf(Buffer.from([1, 2, 3]), Uint8Array.prototype));
everyWay("plain bytes under the prototype of buffers", () => Object.setPrototypeOf(new Uint8Array([1, 2, 3]), Buffer.prototype));
everyWay("no prototype", () => Object.setPrototypeOf(Buffer.from([1, 2, 3]), null));
everyWay("another prototype", () => Object.setPrototypeOf(Buffer.from([1, 2, 3]), { length: "from another prototype", readUInt8: () => "other", slice: () => [0], toString: () => "other" }));
class Below extends Buffer {}
Object.defineProperty(Below.prototype, "length", { get: () => 55 });
everyWay("a class below", () => Object.setPrototypeOf(Buffer.from([1, 2, 3]), Below.prototype));
everyWay("a part of a buffer", () => Buffer.from([1, 2, 3]).subarray(1));
everyWay("bytes of a pool", () => Buffer.allocUnsafe(3).fill(4));

function changedInBetween(size: number): string {
  const bytes = Buffer.alloc(size, 1);
  const before = bytes.length;
  Object.defineProperty(bytes, "length", { value: -1 });
  return before + " " + bytes.length;
}
function handedOutInBetween(size: number, change: (bytes: Buffer) => void): string {
  const bytes = Buffer.alloc(size, 1);
  const before = bytes.length;
  change(bytes);
  return before + " " + bytes.length;
}
say("changed in between", () => changedInBetween(3));
say("handed out in between", () => handedOutInBetween(3, bytes => void Object.setPrototypeOf(bytes, { length: "changed" })));
say("handed out and left alone", () => handedOutInBetween(3, () => {}));
(globalThis as any).kept = [sumOfNew, sizesOfNew, sumOfFollowed];
