import { bench, run } from "mitata";

const N = parseInt(process.argv.slice(2).at(0) || "10", 10);

bench("new Buffer(0)", () => {
  return new Buffer(0);
});

bench(`new Buffer(${N})`, () => {
  return new Buffer(N);
});

bench(`Buffer.alloc(${N})`, () => {
  return Buffer.alloc(N);
});

bench(`Buffer.allocUnsafe(${N})`, () => {
  return Buffer.allocUnsafe(N);
});

bench("Buffer.allocUnsafe(24_000)", () => {
  return Buffer.allocUnsafe(24_000);
});

bench("Buffer.alloc(24_000)", () => {
  return Buffer.alloc(24_000);
});

await run();
