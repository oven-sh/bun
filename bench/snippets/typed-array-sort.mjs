import { bench, run } from "../runner.mjs";

const randomFloats = Float64Array.from({ length: 1024 }, () => Math.random() * 1000);
const randomInts = Int32Array.from({ length: 1024 }, () => (Math.random() * 1000) | 0);
const small = Float64Array.from({ length: 16 }, () => Math.random() * 1000);

bench("Float64Array#sort (1024 random)", () => {
  return randomFloats.slice().sort();
});

bench("Int32Array#sort (1024 random)", () => {
  return randomInts.slice().sort();
});

bench("Float64Array#sort (16 random)", () => {
  return small.slice().sort();
});

bench("Float64Array#sort with comparator (1024 random)", () => {
  return randomFloats.slice().sort((a, b) => a - b);
});

await run();
