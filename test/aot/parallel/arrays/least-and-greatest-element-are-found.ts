// Loops that look for the least or the greatest element of a typed array, and loops whose turn chooses one of two values by a test.
const starts = [0, 1, -1, 100, 127, 128, 255, 256, 32767, 32768, 65535, 65536, -128, -129, -32768, -32769, 2147483647, -2147483648];
const otherStarts = [0.5, -0, NaN, Infinity, -Infinity, 4294967296, -4294967297];
const lengths = [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 1000];

function show(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
function greatestByte(length: number, start: number): number {
  const view = Uint8Array.from({ length }, (_, k) => k * 37);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) {
    const element = view[k]!;
    if (element > found) found = element;
  }
  return found;
}
function leastSignedByte(length: number, start: number): number {
  const view = Int8Array.from({ length }, (_, k) => k * 37);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) if (view[k]! < found) found = view[k]!;
  return found;
}
function greatestShort(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) found = view[k]! > found ? view[k]! : found;
  return found;
}
function leastShort(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => 65535 - k * 7919);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) found = found <= view[k]! ? found : view[k]!;
  return found;
}
function greatestSignedShort(length: number, start: number): number {
  const view = Int16Array.from({ length }, (_, k) => k * 7919);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) found = Math.max(found, view[k]!);
  return found;
}
function leastWord(length: number, start: number): number {
  const view = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let found = start | 0;
  for (let k = 0; k < view.length; k++) found = Math.min(view[k]!, found);
  return found;
}
function greatestWord(length: number, start: number): number {
  const view = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let found = start | 0;
  for (const element of view) if (element >= found) found = element;
  return found;
}
function greatestUnsignedWord(length: number, start: number): number {
  const view = Uint32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let found = start | 0;
  for (let k = 0; k < view.length; k++) if (view[k]! > found) found = view[k]!;
  return found;
}
function greatestOfBuffer(length: number, start: number): number {
  const view = Buffer.alloc(length, 7);
  if (length > 5) view[5] = 201;
  let found = start | 0;
  for (let k = 0; k < view.length; k++) if (view[k]! > found) found = view[k]!;
  return found;
}
function leastAndGreatest(length: number, start: number): string {
  const view = Int16Array.from({ length }, (_, k) => k * 7919);
  let least = start | 0;
  let greatest = start | 0;
  for (let k = 0; k < view.length; k++) {
    const element = view[k]!;
    if (element < least) least = element;
    if (element > greatest) greatest = element;
  }
  return show(least) + "/" + show(greatest);
}
function greatestChangedFirst(length: number, start: number): number {
  const view = Uint8Array.from({ length }, (_, k) => k * 11);
  let found = start | 0;
  for (let k = 0; k < view.length; k++) {
    const element = view[k]! * 3 - 100;
    if (element > found) found = element;
  }
  return found;
}
// What is found is a number of any kind.
function greatestShortOrNumber(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let found = start;
  for (let k = 0; k < view.length; k++) if (view[k]! > found) found = view[k]!;
  return found;
}
function leastWordOrNumber(length: number, start: number): number {
  const view = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761));
  let found = start;
  for (let k = 0; k < view.length; k++) found = Math.min(found, view[k]!);
  return found;
}
// Not only the greatest but where it stands.
function placeOfGreatest(length: number, start: number): string {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let found = start | 0;
  let place = -1;
  for (let k = 0; k < view.length; k++) {
    if (view[k]! > found) {
      found = view[k]!;
      place = k;
    }
  }
  return show(found) + "@" + place;
}
function howManyAreGreater(length: number, start: number): number {
  const view = Uint16Array.from({ length }, (_, k) => k * 7919);
  let count = 0;
  for (let k = 0; k < view.length; k++) if (view[k]! > start) count++;
  return count;
}

function keptBelow(length: number, limit: number): string {
  const from = Int16Array.from({ length }, (_, k) => k * 7919);
  const to = new Int16Array(length);
  for (let k = 0; k < from.length; k++) to[k] = from[k]! > limit ? limit : from[k]!;
  return to.join();
}
function keptBetweenByTests(length: number, limit: number): string {
  const from = Int32Array.from({ length }, (_, k) => Math.imul(k, 2654435761) >> 12);
  const to = new Int32Array(length);
  for (let k = 0; k < from.length; k++) {
    let element = from[k]!;
    if (element < -limit) element = -limit;
    if (element > limit) element = limit;
    to[k] = element;
  }
  return to.join();
}
function greaterOfTwo(length: number): string {
  const left = Uint8Array.from({ length }, (_, k) => k * 37);
  const right = Uint8Array.from({ length }, (_, k) => 255 - k * 11);
  for (let k = 0; k < left.length; k++) left[k] = left[k]! > right[k]! ? left[k]! : right[k]!;
  return left.join();
}
function storedOnOneWay(length: number, limit: number): string {
  const from = Int16Array.from({ length }, (_, k) => k * 7919);
  const to = new Int16Array(length).fill(-1);
  for (let k = 0; k < from.length; k++) if (from[k]! > limit) to[k] = from[k]!;
  return to.join();
}

for (let round = 0; round < 3; round++) {
  const lines: string[] = [];
  for (const length of lengths) {
    for (const start of [...starts, ...otherStarts]) {
      lines.push(
        [greatestByte, leastSignedByte, greatestShort, leastShort, greatestSignedShort, leastWord, greatestWord, greatestUnsignedWord, greatestOfBuffer, greatestChangedFirst, greatestShortOrNumber, leastWordOrNumber, howManyAreGreater]
          .map(find => show(find(length, start)))
          .concat(leastAndGreatest(length, start), placeOfGreatest(length, start))
          .join(" "),
      );
    }
    if (length <= 33) for (const limit of [0, 100, 20000, 40000]) lines.push([keptBelow(length, limit), keptBetweenByTests(length, limit), storedOnOneWay(length, limit)].join(" | "));
    if (length <= 33) lines.push(greaterOfTwo(length));
  }
  if (round === 2) console.log(lines.join("\n"));
}
