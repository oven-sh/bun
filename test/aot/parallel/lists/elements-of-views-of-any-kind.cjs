// An element that was stored into a typed array, or read off it, is known until something may have written it.
"use strict";
const out = [];
function rotate(a, b) {
  return (a << b) | (a >>> (32 - b));
}
function quarter(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) | 0;
  x[d] = rotate(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) | 0;
  x[b] = rotate(x[b] ^ x[c], 12);
}
function rounds(x, n) {
  for (let i = 0; i < n; i++) {
    quarter(x, 0, 4, 8, 12);
    quarter(x, 1, 5, 9, 13);
    quarter(x, 2, 6, 10, 14);
    quarter(x, 3, 7, 11, 15);
  }
  return x[0] + x[15];
}
function stored(x, v, i) {
  x[0] = v;
  x[1] = x[0] + 1;
  x[i] = v * 3;
  x[2] = x[0] - x[1];
  x[i] += x[i];
  return [x[0], x[1], x[2], x[i], x[9]].join();
}
function aliased(x, y, v) {
  x[0] = v;
  x[1] = v + 1;
  y[0] = 7;
  const first = x[0];
  y[1] = 9;
  x[2] = x[1];
  return [first, x[0], x[1], x[2]].join();
}
function viewed(x, data, v) {
  x[0] = v;
  data.setInt8(1, 5);
  const first = x[0];
  x[3] = first;
  x.set([1, 2], 2);
  return [first, x[3], x[2]].join();
}
function write(x, i) {
  x[i] = 77;
}
function called(x, v) {
  x[0] = v;
  x[1] = v;
  write(x, 1);
  return [x[0], x[1]].join();
}
function resized(x, v, length) {
  x[0] = v;
  x[7] = v;
  x.buffer.resize(length);
  return [x[0], x[7], x.length].join();
}
const kinds = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
const values = [0, -0, 1, -1, 255, 256, 300, -129, 65537, 2147483648, 4294967295, -2147483649, 0.5, 1.5, -2.5, 1e300, NaN, Infinity];
for (const Kind of kinds) {
  for (const value of values) {
    const buffer = new ArrayBuffer(128), x = new Kind(buffer, 0, 8), y = new Kind(buffer, x.BYTES_PER_ELEMENT, 8), data = new DataView(buffer);
    out.push(Kind.name + " " + [stored(x, value, 5), stored(x, value, 1), stored(x, value, 9), aliased(x, x, value), aliased(x, y, value), aliased(y, x, value), viewed(x, data, value), called(x, value)].join(" "));
    out.push([resized(new Kind(new ArrayBuffer(64, { maxByteLength: 128 })), value, 8), resized(new Kind(new ArrayBuffer(64, { maxByteLength: 128 })), value, 128)].join(" "));
  }
}
for (const x of [new Int32Array(16), new Uint32Array(16), new Int32Array(13), new Uint32Array(3), new Float64Array(16), new Uint8Array(20)]) {
  for (let i = 0; i < x.length; i++) x[i] = Math.imul(i + 1, 0x9e3779b9);
  out.push(String(rounds(x, 5 + (x.length & 3))) + " " + Array.from(x).join());
}
const moved = new Int32Array(16);
structuredClone(moved.buffer, { transfer: [moved.buffer] });
out.push(String(rounds(moved, 4)), stored(moved, 3, 2));
for (const line of out) console.log(Object.is(line, -0) ? "-0" : line);
