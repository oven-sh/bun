// Takes short parts of views whose species, own constructor or prototype names another class of view, reads them and stores into them.
function firstOfPart(view: Uint8Array): number {
  const part = view.subarray(8, 10);
  return part[0] + part.length * 100000 + part.byteLength * 1000000;
}
function storeInPart(view: Uint8Array): number {
  const part = view.subarray(8, 10);
  part[0] = 0x1234;
  return view[8] * 1000 + view[9];
}
function twice(view: Uint8Array): number {
  const part = view.subarray(8, 12).subarray(0, 1);
  return part[0] + part.byteLength * 1000000;
}
class Doubles extends Uint8Array {
  static get [Symbol.species]() {
    return Float64Array;
  }
}
class Plain extends Uint8Array {}
class Words extends Uint8Array {
  static get [Symbol.species]() {
    return Uint16Array;
  }
}
function filled<T extends Uint8Array>(view: T): T {
  for (let i = 0; i < view.length; i++) view[i] = i + 1;
  return view;
}
function own(): Uint8Array {
  const view: any = filled(new Uint8Array(64));
  view.constructor = { [Symbol.species]: Uint16Array };
  return view;
}
function relinked(): Uint8Array {
  const view: any = filled(new Uint8Array(64));
  Object.setPrototypeOf(view, Uint16Array.prototype);
  return view;
}
const makers: (() => Uint8Array)[] = [
  () => filled(new Uint8Array(64)),
  () => filled(new Plain(64)),
  () => filled(new Words(64)),
  () => filled(new Doubles(64)),
  own,
  relinked,
];
const seen = new Set<string>();
for (let turn = 0; turn < 600; turn++) {
  const make = makers[turn < 300 ? 0 : turn % makers.length];
  seen.add(
    (turn < 300 ? 0 : turn % makers.length) +
      ": " +
      firstOfPart(make()) +
      " " +
      storeInPart(make()) +
      " " +
      twice(make()),
  );
}
for (const line of seen) console.log(line);
