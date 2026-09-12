import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { StringDecoder } from "node:string_decoder";
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

// 'ascii' decode is `byte & 0x7F`. All-ASCII input is the common case; a high
// byte anywhere in the input used to select a different path.
for (const size of [16, 1024, 16 * 1024, 64 * 1024, 4 * 1024 * 1024]) {
  const ascii = Buffer.alloc(size, "a");
  const oneHighByte = Buffer.alloc(size, "a");
  oneHighByte[size >> 1] = 0xe2;
  const allHighBytes = Buffer.alloc(size, 0xe2);

  bench(`Buffer(${size}).toString('ascii'), ASCII input`, () => {
    return ascii.toString("ascii");
  });

  bench(`Buffer(${size}).toString('ascii'), one high byte`, () => {
    return oneHighByte.toString("ascii");
  });

  bench(`Buffer(${size}).toString('ascii'), all high bytes`, () => {
    return allHighBytes.toString("ascii");
  });

  const decoder = new StringDecoder("ascii");
  bench(`StringDecoder('ascii').write(Buffer(${size})), ASCII input`, () => {
    return decoder.write(ascii);
  });
}

await run();
