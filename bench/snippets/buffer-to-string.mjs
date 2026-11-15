import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

const bigBuffer = Buffer.from("hello world".repeat(10000));
const converted = bigBuffer.toString("base64");
const uuid = crypto.randomBytes(16);

bench(`Buffer(${bigBuffer.byteLength}).toString('base64')`, () => {
  return bigBuffer.toString("base64");
});

bench(`Buffer(${uuid.byteLength}).toString('base64')`, () => {
  return uuid.toString("base64");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('base64url')`, () => {
  return bigBuffer.toString("base64url");
});

bench(`Buffer(${uuid.byteLength}).toString('base64url')`, () => {
  return uuid.toString("base64url");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('hex')`, () => {
  return bigBuffer.toString("hex");
});

bench(`Buffer(${uuid.byteLength}).toString('hex')`, () => {
  return uuid.toString("hex");
});

bench(`Buffer(${bigBuffer.byteLength}).toString('ascii')`, () => {
  return bigBuffer.toString("ascii");
});

// UTF-8 with ill-formed sequences. mitata decodes one buffer many times, and a
// branch predictor learns text that repeats: compare these rows only between
// two builds, not with each other.
const fill = (text, bytes) => {
  const unit = Buffer.from(text);
  return Buffer.alloc(bytes - (bytes % unit.length), unit);
};
const after = (bytes, buffer) => Buffer.concat([Buffer.from(bytes), buffer]);
const megabyte = 1024 * 1024;
const cjk = fill("世界你好", megabyte); // 3 bytes per character
const oneIllFormedByte = Buffer.from(cjk);
oneIllFormedByte[oneIllFormedByte.length >> 1] = 0xff;
const spanish = "El pingüino Wenceslao hizo kilómetros bajo exhaustiva lluvia y frío, añoraba a su querido cachorro. ";
// Records that a writer cut at 255 bytes, most of them inside a character.
const jsonLines = Buffer.concat(
  [1, 22, 333].map(id =>
    after(
      Buffer.from(`{"id":${id},"text":"${"吾輩は猫である。名前はまだ無い。".repeat(8)}"}`).subarray(0, 255),
      Buffer.from("\n"),
    ),
  ),
);
for (const [name, buffer] of [
  ["3 bytes per character", cjk],
  ["last character cut", cjk.subarray(0, cjk.length - 1)],
  ["first byte cut", cjk.subarray(1)],
  ["one ill-formed byte", oneIllFormedByte],
  ["lines of JSON cut at 255 bytes", fill(jsonLines, megabyte)],
  ["one cp1252 byte, then Spanish prose", after([0x49, 0x74, 0x92, 0x73, 0x20], fill(spanish, megabyte))],
  [
    "0xFF, then prose with an emoji each 48 bytes",
    after([0xff], fill("It was the best of times, it was the worst. 😀", megabyte)),
  ],
  ["0xFF, then ASCII with an accent each 64 bytes", after([0xff], fill(Buffer.alloc(62, "a") + "é", megabyte))],
  ["latin1 text", Buffer.from("Le café est très bon, garçon! ".repeat(megabyte / 30), "latin1")],
  ["C3 28 repeated", Buffer.alloc(megabyte, Buffer.from([0xc3, 0x28]))],
  ["ill-formed bytes", Buffer.alloc(megabyte, 0xff)],
  ["96 bytes, last character cut", cjk.subarray(0, 95)],
  ["96 bytes, first byte cut", cjk.subarray(1, 97)],
  ["2 KiB of Spanish prose with one cp1252 byte", after([0x49, 0x74, 0x92, 0x73, 0x20], fill(spanish, 2048))],
]) {
  bench(`Buffer(${buffer.byteLength}).toString('utf8'), ${name}`, () => {
    return buffer.toString("utf8");
  });
}

await run();
