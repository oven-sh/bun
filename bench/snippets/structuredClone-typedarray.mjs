import { bench, group, run, summary } from "../runner.mjs";

// === TypedArray structuredClone benchmarks ===

// Uint8Array at various sizes
var uint8_64 = new Uint8Array(64);
var uint8_1K = new Uint8Array(1024);
var uint8_64K = new Uint8Array(64 * 1024);
var uint8_1M = new Uint8Array(1024 * 1024);

// Fill with non-zero data to be realistic
for (var i = 0; i < uint8_64.length; i++) uint8_64[i] = i & 0xff;
for (var i = 0; i < uint8_1K.length; i++) uint8_1K[i] = i & 0xff;
for (var i = 0; i < uint8_64K.length; i++) uint8_64K[i] = i & 0xff;
for (var i = 0; i < uint8_1M.length; i++) uint8_1M[i] = i & 0xff;

// Other typed array types (1KB each)
var int8_1K = new Int8Array(1024);
var uint16_1K = new Uint16Array(512); // 1KB
var int32_1K = new Int32Array(256); // 1KB
var float32_1K = new Float32Array(256); // 1KB
var float64_1K = new Float64Array(128); // 1KB
var bigint64_1K = new BigInt64Array(128); // 1KB

for (var i = 0; i < int8_1K.length; i++) int8_1K[i] = (i % 256) - 128;
for (var i = 0; i < uint16_1K.length; i++) uint16_1K[i] = i;
for (var i = 0; i < int32_1K.length; i++) int32_1K[i] = i * 1000;
for (var i = 0; i < float32_1K.length; i++) float32_1K[i] = i * 0.1;
for (var i = 0; i < float64_1K.length; i++) float64_1K[i] = i * 0.1;
for (var i = 0; i < bigint64_1K.length; i++) bigint64_1K[i] = BigInt(i);

// Slice view (byteOffset != 0) — should fall back to slow path
var sliceBuf = new ArrayBuffer(2048);
var uint8_slice = new Uint8Array(sliceBuf, 512, 512);

summary(() => {
  group("Uint8Array by size", () => {
    bench("Uint8Array 64B", () => structuredClone(uint8_64));
    bench("Uint8Array 1KB", () => structuredClone(uint8_1K));
    bench("Uint8Array 64KB", () => structuredClone(uint8_64K));
    bench("Uint8Array 1MB", () => structuredClone(uint8_1M));
  });
});

summary(() => {
  group("TypedArray types (1KB each)", () => {
    bench("Int8Array", () => structuredClone(int8_1K));
    bench("Uint8Array", () => structuredClone(uint8_1K));
    bench("Uint16Array", () => structuredClone(uint16_1K));
    bench("Int32Array", () => structuredClone(int32_1K));
    bench("Float32Array", () => structuredClone(float32_1K));
    bench("Float64Array", () => structuredClone(float64_1K));
    bench("BigInt64Array", () => structuredClone(bigint64_1K));
  });
});

// Pre-create for fair comparison
var uint8_whole = new Uint8Array(512);
for (var i = 0; i < 512; i++) uint8_whole[i] = i & 0xff;

summary(() => {
  group("fast path vs slow path (512B)", () => {
    bench("Uint8Array whole (fast path)", () => structuredClone(uint8_whole));
    bench("Uint8Array slice (slow path)", () => structuredClone(uint8_slice));
  });
});

await run();
