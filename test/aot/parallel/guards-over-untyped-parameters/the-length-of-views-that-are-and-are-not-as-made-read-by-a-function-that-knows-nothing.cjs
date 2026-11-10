"use strict";
function size(x) { return x.length; }
const found = { size }[JSON.parse('"size"')];
class Odd extends Uint8Array { get length() { return -7; } }
const laidOver = new Float64Array(3); Object.defineProperty(laidOver, "length", { value: "own" });
const moved = new Int16Array(4); Object.setPrototypeOf(moved, { length: "of another prototype" });
const bare = new Uint32Array(5); Object.setPrototypeOf(bare, null);
const growing = new ArrayBuffer(8, { maxByteLength: 32 }), follows = new Uint8Array(growing), fixed = new Uint8Array(growing, 0, 4);
const gone = new Uint8Array(6);
const named = new Uint8Array(2); named.extra = 1;
const all = [new Uint8Array(9), Buffer.from([1, 2, 3]), Buffer.alloc(0), new Float32Array(7), new BigInt64Array(2), new Uint8ClampedArray(11), Buffer.from("abcdef").subarray(1, 4), new DataView(new ArrayBuffer(4)), new Odd(3), laidOver, moved, bare, follows, fixed, gone, named, [1, 2], "text", { length: "a record's" }];
for (let round = 0; round < 3; round++) {
  console.log(all.map(one => String(found(one))).join(" | "));
  if (round === 0) { growing.resize(16); gone.buffer.transfer(); }
  if (round === 1) growing.resize(2);
}
