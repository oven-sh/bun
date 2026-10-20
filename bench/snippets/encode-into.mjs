import { bench, run } from "../runner.mjs";

const encoder = new TextEncoder();

const buffer = new Uint8Array(1024);
bench("encodeInto", () => {
  encoder.encodeInto("Hello World!", buffer);
});

// The same Latin-1 text held by the engine as 8-bit and as 16-bit.
const N = 1 << 20;
const latin1Dense8 = Buffer.alloc(N, 0xe9).toString("latin1");
const latin1Dense16 = (() => {
  const w = Buffer.alloc(N * 2);
  for (let i = 0; i < N; i++) w.writeUInt16LE(0xe9, 2 * i);
  return w.toString("utf16le");
})();
const latin1Mixed8 = (() => {
  const b = Buffer.alloc(N);
  for (let i = 0; i < N; i++) b[i] = i % 3 === 0 ? 0xe9 : 0x61;
  return b.toString("latin1");
})();
const ascii8 = Buffer.alloc(N, 0x61).toString("latin1");
// Exact-size destinations, the shape WebSocket and TextEncoderStream use.
const denseDest = new Uint8Array(N * 2);
const mixedDest = new Uint8Array(encoder.encode(latin1Mixed8).byteLength);
const asciiDest = new Uint8Array(N);

bench(`encodeInto ${N} ascii 8-bit`, () => {
  encoder.encodeInto(ascii8, asciiDest);
});

bench(`encodeInto ${N} latin1 dense 8-bit`, () => {
  encoder.encodeInto(latin1Dense8, denseDest);
});

bench(`encodeInto ${N} latin1 dense 16-bit`, () => {
  encoder.encodeInto(latin1Dense16, denseDest);
});

bench(`encodeInto ${N} latin1 mixed 8-bit (exact fit)`, () => {
  encoder.encodeInto(latin1Mixed8, mixedDest);
});

await run();
