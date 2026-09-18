import { bench, run } from "../runner.mjs";

var short = "Hello World!";
var shortUTF16 = "Hello World 💕💕💕";
var long = "Hello World!".repeat(1024);
var longUTF16 = "Hello World 💕💕💕".repeat(1024);
var encoder = new TextEncoder();

bench(`4 ascii`, () => {
  encoder.encode("heyo");
});

bench(`4 utf8`, () => {
  encoder.encode("💕💕");
});

bench(`${short.length} ascii`, () => {
  encoder.encode(short);
});

bench(`${short.length} utf8`, () => {
  encoder.encode(shortUTF16);
});

bench(`${long.length} ascii`, () => {
  encoder.encode(long);
});

bench(`${longUTF16.length} utf8`, () => {
  encoder.encode(longUTF16);
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
const shortLatin1 = "héllo wörld";

bench(`${shortLatin1.length} latin1`, () => {
  encoder.encode(shortLatin1);
});

bench(`${N} ascii 8-bit`, () => {
  encoder.encode(ascii8);
});

bench(`${N} latin1 dense 8-bit`, () => {
  encoder.encode(latin1Dense8);
});

bench(`${N} latin1 dense 16-bit`, () => {
  encoder.encode(latin1Dense16);
});

bench(`${N} latin1 mixed 8-bit`, () => {
  encoder.encode(latin1Mixed8);
});

bench(`Buffer.from ${N} ascii 8-bit`, () => {
  Buffer.from(ascii8);
});

bench(`Buffer.from ${N} latin1 dense 8-bit`, () => {
  Buffer.from(latin1Dense8);
});

bench(`Buffer.from ${N} latin1 dense 16-bit`, () => {
  Buffer.from(latin1Dense16);
});

await run();
