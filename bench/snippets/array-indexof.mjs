import { bench, run } from "../runner.mjs";

const ints = Array.from({ length: 1024 }, (_, i) => i);
const strings = Array.from({ length: 1024 }, (_, i) => `string-value-${i}`);
const int32 = new Int32Array(1024).map((_, i) => i);
const float64 = new Float64Array(1024).map((_, i) => i);

// rotate needles so the engine cannot hoist the search out of the benchmark loop
const intNeedles = [1000, 512, 1023, 2048]; // 3 hits at varying depth + 1 miss
const stringNeedles = ["string-value-1000", "string-value-512", "string-value-1023", "string-value-not-found"];
let cursor = 0;

bench("Array#indexOf (1024 ints)", () => {
  return ints.indexOf(intNeedles[cursor++ & 3]);
});

bench("Array#includes (1024 ints)", () => {
  return ints.includes(intNeedles[cursor++ & 3]);
});

bench("Array#lastIndexOf (1024 ints)", () => {
  return ints.lastIndexOf(intNeedles[cursor++ & 3]);
});

bench("Array#indexOf (1024 strings)", () => {
  return strings.indexOf(stringNeedles[cursor++ & 3]);
});

bench("Array#includes (1024 strings)", () => {
  return strings.includes(stringNeedles[cursor++ & 3]);
});

bench("Array#lastIndexOf (1024 strings)", () => {
  return strings.lastIndexOf(stringNeedles[cursor++ & 3]);
});

bench("Int32Array#lastIndexOf (1024)", () => {
  return int32.lastIndexOf(intNeedles[cursor++ & 3]);
});

bench("Float64Array#lastIndexOf (1024)", () => {
  return float64.lastIndexOf(intNeedles[cursor++ & 3]);
});

// upstream-style hot loop: one call site, stable receiver and needle, enough
// inner iterations that the site is compiled by the optimizing JIT tiers
// (mirrors JSTests/microbenchmarks/array-indexof-string-8bit-long.js)
const hotArr = Array.from({ length: 64 }, (_, i) => String.fromCharCode(65 + (i % 26)) + "x".repeat(63));
const hotKey = "@" + "x".repeat(63);

bench("indexOf hot loop x 1e4 (64 x 64-char strings, miss)", () => {
  let result = 0;
  for (let i = 0; i < 1e4; i++) result += hotArr.indexOf(hotKey);
  return result;
});

bench("includes hot loop x 1e4 (64 x 64-char strings, miss)", () => {
  let result = 0;
  for (let i = 0; i < 1e4; i++) result += hotArr.includes(hotKey);
  return result;
});

await run();
