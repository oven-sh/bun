// Buffer base64/base64url decoding across the input shapes that take
// different paths through the decoder: clean input for each alphabet,
// whitespace-wrapped input, input with non-alphabet bytes, and writes into an
// existing Buffer.
import { bench, run } from "../runner.mjs";

function deterministicBytes(n) {
  const b = Buffer.allocUnsafe(n);
  let state = 0x12345678;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    b[i] = state & 0xff;
  }
  return b;
}

const MiB = 1 << 20;
const bytes1M = deterministicBytes(MiB);
const bytes64K = deterministicBytes(64 * 1024);
const bytes512 = deterministicBytes(512);

const b64_1M = bytes1M.toString("base64");
const b64url_1M = bytes1M.toString("base64url");
const b64_1M_wrapped = b64_1M.replace(/(.{76})/g, "$1\r\n");
const b64_64K_garbage = bytes64K.toString("base64").replace(/(.{100})/g, "$1\x01");
const b64url_512 = bytes512.toString("base64url");

const writeDst = Buffer.allocUnsafe(MiB + 16);

bench("Buffer.from 1 MiB base64", () => {
  Buffer.from(b64_1M, "base64");
});

bench("Buffer.from 1 MiB base64url", () => {
  Buffer.from(b64url_1M, "base64url");
});

bench("Buffer.from 1 MiB base64, CRLF every 76 chars", () => {
  Buffer.from(b64_1M_wrapped, "base64");
});

bench('Buffer.from 1 MiB URL alphabet as "base64"', () => {
  Buffer.from(b64url_1M, "base64");
});

bench("Buffer.from 64 KiB base64 with 1% garbage bytes", () => {
  Buffer.from(b64_64K_garbage, "base64");
});

bench(`Buffer.from ${b64url_512.length}-char base64url (512 bytes)`, () => {
  Buffer.from(b64url_512, "base64url");
});

bench("buf.write 1 MiB base64 into existing Buffer", () => {
  writeDst.write(b64_1M, 0, "base64");
});

await run();
