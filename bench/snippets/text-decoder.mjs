import { bench, run } from "../runner.mjs";

var short = new TextEncoder().encode("Hello World!");
var shortUTF16 = new TextEncoder().encode("Hello World 💕💕💕");
var long = new TextEncoder().encode("Hello World!".repeat(1024));
var longUTF16 = new TextEncoder().encode("Hello World 💕💕💕".repeat(1024));
var decoder = new TextDecoder();
bench(`${short.length} ascii`, () => {
  decoder.decode(short);
});

bench(`${short.length} utf8`, () => {
  decoder.decode(shortUTF16);
});

bench(`${long.length} ascii`, () => {
  decoder.decode(long);
});

bench(`${longUTF16.length} utf8`, () => {
  decoder.decode(longUTF16);
});

// Ill-formed input, and stream chunks that end inside a character. mitata
// decodes one input many times, and a branch predictor learns text that
// repeats: compare these rows only between two builds, not with each other.
const encoder = new TextEncoder();
const fill = (text, bytes) => {
  const unit = typeof text === "string" ? encoder.encode(text) : text;
  const filled = new Uint8Array(bytes - (bytes % unit.length));
  for (let at = 0; at < filled.length; at += unit.length) filled.set(unit, at);
  return filled;
};
const after = (bytes, input) => {
  const joined = new Uint8Array(bytes.length + input.length);
  joined.set(bytes);
  joined.set(input, bytes.length);
  return joined;
};
const megabyte = 1024 * 1024;
const cjk = fill("世界你好", megabyte); // 3 bytes per character
const cutTail = cjk.subarray(0, cjk.length - 1);
const oneIllFormedByte = Uint8Array.from(cjk);
oneIllFormedByte[oneIllFormedByte.length >> 1] = 0xff;
const spanish = "El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y frío, añoraba a su querido cachorro. ";
const latin1 = new Uint8Array(megabyte);
for (let i = 0; i < latin1.length; i++) latin1[i] = "Le caf\xe9 est tr\xe8s bon, gar\xe7on! ".charCodeAt(i % 30);
const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
for (const [name, input] of [
  ["utf8, 3 bytes per character", cjk],
  ["utf8, last character cut", cutTail],
  ["utf8, first byte cut", cjk.subarray(1)],
  ["utf8, one ill-formed byte", oneIllFormedByte],
  ["one cp1252 byte, then Spanish prose", after([0x49, 0x74, 0x92, 0x73, 0x20], fill(spanish, megabyte))],
  [
    "0xFF, then prose with an emoji each 48 bytes",
    after([0xff], fill("It was the best of times, it was the worst. 😀", megabyte)),
  ],
  ["0xFF, then ASCII with an accent each 64 bytes", after([0xff], fill("a".repeat(62) + "é", megabyte))],
  ["latin1 text as utf8", latin1],
  ["C3 28 repeated", fill(Uint8Array.of(0xc3, 0x28), megabyte)],
  ["ill-formed bytes", new Uint8Array(megabyte).fill(0xff)],
  ["96 bytes, last character cut", cjk.subarray(0, 95)],
  ["2 KiB of Spanish prose with one cp1252 byte", after([0x49, 0x74, 0x92, 0x73, 0x20], fill(spanish, 2048))],
]) {
  bench(`${input.length} ${name}`, () => {
    decoder.decode(input);
  });
}
bench(`${cutTail.length} fatal, last character cut`, () => {
  try {
    fatalDecoder.decode(cutTail);
  } catch {}
});
for (const [name, size] of [
  ["64 KiB chunks that end between characters", 65536 - (65536 % 3)],
  ["64 KiB chunks that end inside a character", 65536],
  ["512-byte chunks", 512],
]) {
  bench(`${cjk.length} stream, ${name}`, () => {
    for (let at = 0; at < cjk.length; at += size) {
      decoder.decode(cjk.subarray(at, at + size), { stream: true });
    }
    decoder.decode();
  });
}

if ("Buffer" in globalThis) {
  const buffer_short = Buffer.from(short);
  bench(`Buffer ${buffer_short.length} ascii`, () => {
    buffer_short.toString("ascii");
  });

  const buffer_shortUTF16 = Buffer.from(short);
  bench(`Buffer ${buffer_shortUTF16.length} utf8`, () => {
    buffer_shortUTF16.toString("utf8");
  });

  const buffer_long = Buffer.from(long);
  bench(`Buffer ${buffer_long.length} ascii`, () => {
    buffer_long.toString("ascii");
  });

  const buffer_longUTF16 = Buffer.from(longUTF16);
  bench(`Buffer ${buffer_longUTF16.length} utf8`, () => {
    buffer_longUTF16.toString("utf8");
  });
}

await run();
