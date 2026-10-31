// read() returns one of two shapes, and only "some" holds another new object. The callback handed to fs opens the world, so nothing proves that `count` is a number.
// On the path that answers "none" the inner object is never made and `count` has no value to store. Every part of the program is needed for the fault.
import { stat } from "node:fs";
type Why = "odd" | "empty";
type Answer<T> = { readonly tag: "some"; readonly value: T } | { readonly tag: "none"; readonly why: Why };
type Width = "narrow" | "wide";
function stepOf(width: Width): number {
  return width === "wide" ? 32 : 20;
}
function read(bytes: Buffer, size: number, width: Width): Answer<{ step: number; count: number }> {
  const step = stepOf(width);
  const count = bytes.readUInt32BE(0);
  return (size - count * step) % 8 === 0 ? { tag: "some", value: { step, count } } : { tag: "none", why: "odd" };
}
function isSome(bytes: Buffer, width: Width): boolean {
  const answer = read(bytes, bytes.length, width);
  return answer.tag === "some";
}
const queue: Array<() => unknown> = [];
const later = (f: () => unknown): void => {
  queue.push(f);
};
let seen = "";
function look(v: unknown): void {
  if (ArrayBuffer.isView(v)) {
    seen = String(v.buffer.byteLength);
  }
}
function some(value: string[]): Answer<string[]> {
  return { tag: "some", value };
}
function none(why: Why): Answer<never> {
  return { tag: "none", why };
}
const ones = Buffer.alloc(15, 1);
later(() => {
  look(isSome(ones, "narrow") ? ones : undefined);
});
later(() => {
  const makers: ReadonlyArray<() => Answer<string[]>> = [() => some([]), () => none("empty")];
  const asked: string[] = [];
  makers[asked.length]();
  look(asked);
});
for (const f of queue) await f();
stat(".", () => {
  console.log("done", seen);
});
