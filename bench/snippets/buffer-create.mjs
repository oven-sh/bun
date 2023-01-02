import { bench, run } from "mitata";

bench("new Buffer(0)", () => {
  return new Buffer(0);
});

const buffer = new ArrayBuffer(10);
bench("new DataView(buffer)", () => {
  return new DataView(buffer);
});

bench("Buffer.alloc(10)", () => {
  return Buffer.alloc(10);
});

bench("Buffer.allocUnsafe(10)", () => {
  return Buffer.allocUnsafe(10);
});

bench("Buffer.allocUnsafe(1024)", () => {
  return Buffer.allocUnsafe(1024);
});

bench("new Uint8Array(0)", () => {
  return new Uint8Array(0);
});

bench("new Uint8Array(10)", () => {
  return new Uint8Array(10);
});

await run();
