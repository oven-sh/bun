// A small function hands its argument back under a type parameter. Each caller says the result is a Holder and hands in a buffer.
// The result goes through a try block first and is asked what it is behind the block, in four ways.
// Flags: --aot-disable=InlineCalls --aot-heat=everything-is-hot
let notes = 0;
function note(value: unknown): void {
  if (notes++ < 4) console.log("noted", value);
}
function isText<T>(value: unknown): value is T {
  return false;
}
class Holder {
  held = 1;
}
function same<T>(value: T | string): T {
  if (isText<string>(value)) return (notes > 1 ? new Holder() : undefined) as T;
  return value as T;
}
function readsMember() {
  const holder: Holder = same<Holder>(new SharedArrayBuffer(8) as any);
  try {
    note(holder);
  } catch {}
  return holder?.held ?? 7;
}
function comparesWithUndefined() {
  const holder: Holder = same<Holder>(new SharedArrayBuffer(8) as any);
  try {
    note(holder);
  } catch {}
  return holder === undefined ? 3 : 7;
}
function asksForKind() {
  const holder: Holder = same<Holder>(new SharedArrayBuffer(8) as any);
  try {
    note(holder);
  } catch {}
  return typeof holder === "object" ? 3 : 7;
}
function asksForClass() {
  const holder: Holder = same<Holder>(new SharedArrayBuffer(8) as any);
  try {
    note(holder);
  } catch {}
  return holder instanceof Holder ? 3 : 7;
}
const sums = [0, 0, 0, 0];
for (let round = 0; round < 1000; round++) {
  sums[0] += readsMember();
  sums[1] += comparesWithUndefined();
  sums[2] += asksForKind();
  sums[3] += asksForClass();
}
console.log(sums.join(" "));
