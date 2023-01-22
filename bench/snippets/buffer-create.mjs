import { bench, run } from "mitata";

const N = parseInt(process.argv.slice(2).at(0) || "10", 10);

bench("Buffer.from('short string')", () => {
  return Buffer.from("short string");
});

var hundred = new ArrayBuffer(100);
bench("Buffer.from(ArrayBuffer(100))", () => {
  return Buffer.from(hundred);
});

var hundredArray = new Uint8Array(100);
bench("Buffer.from(Uint8Array(100))", () => {
  return Buffer.from(hundredArray);
});

var empty = new Uint8Array(0);
bench("Buffer.from(Uint8Array(0))", () => {
  return Buffer.from(empty);
});

bench("new Buffer(Uint8Array(0))", () => {
  return new Buffer(empty);
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
