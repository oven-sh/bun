// Loops that add up the elements of a typed array, from every kind of start: whole, with a fraction, too far from zero for every whole number to be told apart, and no number at all.
const starts = [0, 1, -7, 0.5, -0, 1e-300, 2 ** 32, 2 ** 51 - 1, 2 ** 51, -(2 ** 51), 2 ** 52 + 1, 2 ** 53, 2 ** 53 - 2, 1e300, Infinity, -Infinity, NaN];
const lengths = [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 1000];

function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function bytes(length: number, start: number): number {
  const view = Uint8Array.from({ length }, (_, k) => k * 37);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function signedBytes(length: number, start: number): number {
  const view = Int8Array.from({ length }, (_, k) => k * 37);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function shorts(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function signedShorts(length: number, start: number): number {
  const view = Int16Array.from({ length }, (_, k) => k * 7919);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function words(length: number, start: number): number {
  const view = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function unsignedWords(length: number, start: number): number {
  const view = Uint32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function clamped(length: number, start: number): number {
  const view = Uint8ClampedArray.from({ length }, (_, k) => k * 5 - 40);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function buffer(length: number, start: number): number {
  const view = Buffer.alloc(length, 201);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function values(length: number, start: number): number {
  const view = Uint8Array.from({ length }, (_, k) => 255 - k);
  let sum = start;
  for (const value of view) sum += value;
  return sum;
}
function downward(length: number, start: number): number {
  const view = Int16Array.from({ length }, (_, k) => k * 311 - 9000);
  let sum = start;
  for (let k = view.length - 1; k >= 0; k--) sum += view[k]!;
  return sum;
}
function within32Bits(length: number, start: number): number {
  const view = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let sum = start | 0;
  for (let k = 0; k < view.length; k++) sum = (sum + view[k]!) | 0;
  return sum;
}
function changedFirst(length: number, start: number): number {
  const view = Uint8Array.from({ length }, (_, k) => k * 11);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]! * 3 - 100;
  return sum;
}
function twoSums(length: number, start: number): string {
  const view = Int16Array.from({ length }, (_, k) => k * 7919);
  let sum = start;
  let doubled = 1;
  for (let k = 0; k < view.length; k++) {
    sum += view[k]!;
    doubled += view[k]! * 2;
  }
  return show(sum) + "/" + show(doubled);
}
function taken(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum -= view[k]!;
  return sum;
}
// Zero has a sign. What is left of it depends on whether all elements are zero or only their sum.
function zeros(length: number, start: number): string {
  const nothing = new Int16Array(length);
  const cancels = new Int16Array(length);
  if (length > 1) {
    cancels[0] = 5;
    cancels[1] = -5;
  }
  let added = start;
  let taken = start;
  let addedAndCanceled = start;
  let takenAndCanceled = start;
  for (let k = 0; k < nothing.length; k++) added += nothing[k]!;
  for (let k = 0; k < nothing.length; k++) taken -= nothing[k]!;
  for (let k = 0; k < cancels.length; k++) addedAndCanceled += cancels[k]!;
  for (let k = 0; k < cancels.length; k++) takenAndCanceled -= cancels[k]!;
  return [added, taken, addedAndCanceled, takenAndCanceled].map(show).join("/");
}
function sumsSoFar(length: number, start: number): string {
  const view = Int32Array.from({ length }, (_, k) => k * 3);
  let sum = start | 0;
  for (let k = 0; k < view.length; k++) {
    sum = (sum + view[k]!) | 0;
    view[k] = sum;
  }
  return view.slice(-3).join();
}
// As far from zero as an element can be, so often that the sum leaves the whole numbers that can be told apart: from there on every addition rounds, in the order of the turns.
function many(length: number, element: number, start: number): number {
  const view = new Int32Array(length).fill(element);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}
function manyShorts(length: number, element: number, start: number): number {
  const view = new Uint16Array(length).fill(element);
  let sum = start;
  for (let k = 0; k < view.length; k++) sum += view[k]!;
  return sum;
}

for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const length of lengths) {
    for (const start of starts) {
      lines.push(
        [bytes, signedBytes, shorts, signedShorts, words, unsignedWords, clamped, buffer, values, downward, within32Bits, changedFirst, taken]
          .map(sum => show(sum(length, start)))
          .concat(twoSums(length, start), zeros(length, start), sumsSoFar(length, start))
          .join(" "),
      );
    }
  }
  if (round === 2) console.log(lines.join("\n"));
}
for (const length of [131071, 131072, 131073, 2097151, 2097153, 4500000]) {
  console.log(length, many(length, 2147483647, 3), many(length, -2147483648, 3), many(length, 2147483647, 0.5), many(length, 2147483646, 2 ** 51 - 5), manyShorts(length, 65535, 1), manyShorts(length, 65535, 2 ** 53 - 70000));
}
