// @runtime bun,node
import { bench, group, run } from "../runner.mjs";

const small = Buffer.alloc(64, 0x42);
const medium = Buffer.alloc(1024, 0x42);
const large = Buffer.alloc(1024 * 1024, 0x42);

group("slice - no args", () => {
  bench("Buffer(64).slice()", () => small.slice());
  bench("Buffer(1024).slice()", () => medium.slice());
  bench("Buffer(1M).slice()", () => large.slice());
});

group("slice - one int arg", () => {
  bench("Buffer(64).slice(10)", () => small.slice(10));
  bench("Buffer(1024).slice(10)", () => medium.slice(10));
  bench("Buffer(1M).slice(1024)", () => large.slice(1024));
});

group("slice - two int args", () => {
  bench("Buffer(64).slice(10, 50)", () => small.slice(10, 50));
  bench("Buffer(1024).slice(10, 100)", () => medium.slice(10, 100));
  bench("Buffer(1M).slice(1024, 4096)", () => large.slice(1024, 4096));
});

group("slice - negative args", () => {
  bench("Buffer(64).slice(-10)", () => small.slice(-10));
  bench("Buffer(1024).slice(-100, -10)", () => medium.slice(-100, -10));
  bench("Buffer(1M).slice(-4096, -1024)", () => large.slice(-4096, -1024));
});

group("subarray - two int args", () => {
  bench("Buffer(64).subarray(10, 50)", () => small.subarray(10, 50));
  bench("Buffer(1024).subarray(10, 100)", () => medium.subarray(10, 100));
  bench("Buffer(1M).subarray(1024, 4096)", () => large.subarray(1024, 4096));
});

await run();
