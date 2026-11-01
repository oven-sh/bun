// One site reads `byteLength` from receivers of many kinds, so it is read by name: a typed array answers with its own length in bytes unless something on the way answers first.
function lengthOf(value) { return value.byteLength; }
function lengthByKey(value, key) { return value[key]; }
function tryLengthOf(value) { try { return value.byteLength; } catch (error) { return error.constructor.name; } }
class Bytes extends Uint8Array {}
class Fixed extends Uint8Array { get byteLength() { return -1; } }

const resizable = new ArrayBuffer(8, { maxByteLength: 32 });
const tracking = new Uint8Array(resizable), window = new Uint8Array(resizable, 2, 4);
const growable = new SharedArrayBuffer(8, { maxByteLength: 32 });
const shared = new Int16Array(growable);
const transferred = new ArrayBuffer(16);
const detached = new Float32Array(transferred);
const transferredBytes = new ArrayBuffer(16);
const detachedBytes = new Uint8Array(transferredBytes, 4, 8);
const receivers = {
  bytes: new Uint8Array(3), clamped: new Uint8ClampedArray(4), shorts: new Int16Array(5), floats: new Float64Array(6), big: new BigUint64Array(7),
  empty: new Uint32Array(0), large: new Uint8Array(100000), view: new Uint8Array(new ArrayBuffer(64), 8, 16), buffer: Buffer.alloc(9), slice: Buffer.from("hello world").subarray(2, 7),
  subclass: new Bytes(10), overridden: new Fixed(11), own: Object.defineProperty(new Uint8Array(12), "byteLength", { value: "own" }), named: Object.assign(new Uint8Array(13), { extra: 1 }),
  orphan: Object.setPrototypeOf(new Uint8Array(14), null), adopted: Object.setPrototypeOf(new Uint8Array(15), { get byteLength() { return "adopted"; } }),
  tracking, window, shared, detached, detachedBytes, array: [1, 2], text: "abc", plain: { byteLength: "plain" }, fn: function (a, b) {}, dataView: new DataView(new ArrayBuffer(8)),
};
function show(label) {
  const line = [];
  for (const [name, receiver] of Object.entries(receivers)) line.push(`${name}=${lengthOf(receiver)}/${lengthByKey(receiver, "byteLength")}/${"byteLength" in Object(receiver)}/${Object.hasOwn(receiver, "byteLength")}`);
  console.log(label, line.join(" "));
}
for (let round = 1; round <= 3; round++) show(`round ${round}`);
resizable.resize(16); growable.grow(24); transferred.transfer(); transferredBytes.transfer();
show("resized");
resizable.resize(4);
show("shrunk");

for (let round = 1; round <= 3; round++)
  console.log(tryLengthOf(Object.create(receivers.bytes)), tryLengthOf(Object.setPrototypeOf({}, Uint8Array.prototype)), tryLengthOf(Uint8Array.prototype), tryLengthOf(new Proxy(receivers.bytes, {})));

for (let round = 1; round <= 6; round++) {
  if (round === 3) Object.defineProperty(Bytes.prototype, "byteLength", { get() { return "from subclass"; }, configurable: true });
  if (round === 5) delete Bytes.prototype.byteLength;
  console.log(round, lengthOf(new Bytes(round)), lengthOf(new Uint8Array(round)), lengthByKey(new Bytes(round), "byteLength"));
}

let total = 0;
const mixed = [new Uint8Array(1), Buffer.alloc(2), new Float64Array(3), new Bytes(4), [1, 2, 3, 4, 5], "sixsix"];
for (let i = 0; i < 60000; i++) total += lengthOf(mixed[i % 6]) ?? 1;
console.log(total);
