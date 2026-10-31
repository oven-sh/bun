// byteOffset, byteLength and length read by name of values that nobody can follow: views at every offset, of every width, over buffers that shrink or are handed away, and objects that answer the names in their own way.
const bag = JSON.parse('{"values":[]}');
const memory = new ArrayBuffer(64);
const growing = new ArrayBuffer(32, { maxByteLength: 64 });
const handedAway = new ArrayBuffer(16);
class Shifted extends Uint8Array {
  get byteOffset() {
    return -1;
  }
}
const withOwn = Object.defineProperty(new Uint8Array(memory, 4, 4), "byteOffset", { value: "own" });
const withoutChain = Object.setPrototypeOf(new Uint8Array(memory, 5, 1), null);
const belowAnother = Object.setPrototypeOf(new Uint8Array(memory, 6, 1), { byteOffset: "inherited" });
bag.values.push(
  new Uint8Array(memory),
  new Uint8Array(memory, 3),
  new Uint8Array(memory, 7, 9),
  new Int16Array(memory, 2, 5),
  new Float64Array(memory, 8, 2),
  new BigInt64Array(memory, 16),
  Buffer.from(memory, 11, 13),
  Buffer.alloc(40).subarray(12, 20),
  new DataView(memory, 9, 3),
  new Uint8Array(growing, 8),
  new Uint16Array(growing, 16, 4),
  new Uint8Array(handedAway, 4, 8),
  new Shifted(memory, 2, 2),
  withOwn,
  withoutChain,
  belowAnother,
  { byteOffset: 77, byteLength: 78, length: 79 },
  memory,
  "text",
  [1, 2, 3],
);
function describe(value) {
  return `${String(value.byteOffset)}|${String(value.byteLength)}|${String(value.length)}`;
}
function describeAll() {
  const parts = [];
  for (const value of bag.values) parts.push(describe(value));
  return parts.join(" ");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = describeAll();
console.log(last);

growing.resize(20);
console.log(describeAll());
growing.resize(4);
console.log(describeAll());
growing.resize(64);
console.log(describeAll());
handedAway.transfer();
console.log(describeAll());

function total(values) {
  let sum = 0;
  for (let turn = 0; turn < 500; turn++) {
    const value = values[turn % 8];
    sum += value.byteOffset + value.byteLength;
  }
  return sum;
}
console.log(total(bag.values));
Object.defineProperty(Object.getPrototypeOf(Int16Array.prototype), "marker", { value: 1, configurable: true });
console.log(total(bag.values), describe(bag.values[3]));
