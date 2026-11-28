// @runtime bun,node
import { Buffer } from "node:buffer";
import { bench, group, run } from "../runner.mjs";

// Small arrays (common case)
const int32Array8 = [1, 2, 3, 4, 5, 6, 7, 8];
const doubleArray8 = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5];

// Medium arrays
const int32Array64 = Array.from({ length: 64 }, (_, i) => i % 256);
const doubleArray64 = Array.from({ length: 64 }, (_, i) => i + 0.5);

// Large arrays
const int32Array1024 = Array.from({ length: 1024 }, (_, i) => i % 256);

// Array-like objects (fallback path)
const arrayLike8 = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, length: 8 };

// Empty array
const emptyArray = [];

// Arrays that are not plain array literals
const arrayWithProperty = Object.assign([1, 2, 3, 4, 5, 6, 7, 8], { extra: 1 });
const frozenArray = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
const subclassArray = class extends Array {}.from(int32Array8);

group("Buffer.from(array) - Int32 arrays", () => {
  bench("Buffer.from(int32[8])", () => Buffer.from(int32Array8));
  bench("Buffer.from(int32[64])", () => Buffer.from(int32Array64));
  bench("Buffer.from(int32[1024])", () => Buffer.from(int32Array1024));
});

group("Buffer.from(array) - Double arrays", () => {
  bench("Buffer.from(double[8])", () => Buffer.from(doubleArray8));
  bench("Buffer.from(double[64])", () => Buffer.from(doubleArray64));
});

group("Buffer.from(array) - Edge cases", () => {
  bench("Buffer.from([])", () => Buffer.from(emptyArray));
  bench("Buffer.from(arrayLike[8])", () => Buffer.from(arrayLike8));
});

group("Buffer.from(array) - Other array shapes", () => {
  bench("Buffer.from(array with a property)", () => Buffer.from(arrayWithProperty));
  bench("Buffer.from(frozen array)", () => Buffer.from(frozenArray));
  bench("Buffer.from(subclass of Array)", () => Buffer.from(subclassArray));
});

group("new Buffer(array)", () => {
  bench("new Buffer(int32[8])", () => new Buffer(int32Array8));
  bench("new Buffer(int32[64])", () => new Buffer(int32Array64));
});

// Keep this group last: the write changes how every later call finds `valueOf`.
group("Buffer.from(array) after a write to Object.prototype.valueOf", () => {
  bench("Buffer.from(int32[8]) after the write", function* () {
    Object.prototype.valueOf = Object.prototype.valueOf;
    yield () => Buffer.from(int32Array8);
  });
  bench("new Buffer(int32[8]) after the write", () => new Buffer(int32Array8));
});

await run();
