// nanoid's charCodes[buffer[i] & mask]: only the run time knows the mask, and the table is as long as the mask allows.
// STATISTIC: UnknownMaskKeysChecked >= 1
function customAlphabet(alphabet) {
  const codes = Uint8Array.from(alphabet, character => character.charCodeAt(0));
  const mask = (2 << (31 - Math.clz32((alphabet.length - 1) | 1))) - 1;
  return size => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 37) & 255;
    for (let i = 0; i < size; i++) bytes[i] = codes[bytes[i] & mask];
    return String.fromCharCode(...bytes);
  };
}
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
for (const alphabet of [letters, "0123456789abcdef", "ab", "a", "0123456789"]) console.log(customAlphabet(alphabet)(90));

function makeFill(codes, mask) {
  return (bytes, end) => {
    for (let i = 0; i < end; i++) bytes[i] = codes[bytes[i] & mask];
    return bytes;
  };
}
function makeSum(codes, mask) {
  return (bytes, end) => {
    let sum = 0;
    for (let i = 0; i < end; i++) sum += codes[bytes[i] & mask];
    return sum;
  };
}
const table = length => Uint8Array.from({ length }, (_, k) => 65 + (k % 50));
const bytes = length => Uint8Array.from({ length }, (_, k) => (k * 37) & 255);
const hash = view => view.reduce((held, value) => (held * 31 + value) | 0, 7);

for (const [length, mask] of [[64, 63], [16, 15], [1, 0], [256, 255], [10, 15], [300, 255], [64, 127]]) {
  const fill = makeFill(table(length), mask);
  const sum = makeSum(table(length), mask);
  let held = 0;
  for (let k = 0; k < 20; k++) held = (held + hash(fill(bytes(200), 200))) | 0;
  console.log(length, mask, held, sum(bytes(200), 200), sum(bytes(8), 12));
}

// Masks that are no small integers.
for (const mask of [-1, -8, 2 ** 32 + 7, 2 ** 31, 1.5, NaN, Infinity, "7", null, undefined, true, { valueOf: () => 3 }]) {
  console.log(typeof mask, hash(makeFill(table(64), mask)(bytes(100), 100)), makeSum(table(8), mask)(bytes(100), 100));
}
for (const mask of [1n, Symbol.iterator]) {
  try {
    makeFill(table(64), mask)(bytes(100), 100);
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}

// The bytes are the table, views of one buffer, other kinds, lists.
const self = bytes(64);
console.log(hash(makeFill(self, 63)(self, 64)));
const buffer = new ArrayBuffer(128);
const halves = [new Uint8Array(buffer, 0, 64), new Uint8Array(buffer, 32, 64)];
halves[0].set(bytes(64));
console.log(hash(makeFill(halves[0], 31)(halves[1], 64)), hash(halves[0]));
for (const View of [Int8Array, Uint8ClampedArray, Uint16Array, Int32Array, Float32Array, Float64Array]) console.log(View.name, hash(makeFill(table(64), 63)(View.from(bytes(90)), 90)), makeSum(View.from(table(32)), 31)(bytes(90), 90));
console.log(makeFill([1, 2, , 4], 3)([0, 1, 2, 3, 4.5, "6", undefined], 7).map(value => value ?? "hole").join());
console.log(makeSum("abcdefgh", 7)(bytes(6), 6));

// Memory that shrinks and goes away.
const resizable = new ArrayBuffer(64, { maxByteLength: 64 });
const codes = new Uint8Array(resizable);
codes.set(table(64));
const fill = makeFill(codes, 63);
console.log(hash(fill(bytes(64), 64)));
resizable.resize(20);
console.log(hash(fill(bytes(64), 64)));
resizable.resize(64);
console.log(hash(fill(bytes(64), 64)));
const moved = bytes(40);
moved.buffer.transfer();
console.log(fill(moved, 40) === moved, moved.length, moved[3], makeSum(moved, 15)(bytes(5), 5));
